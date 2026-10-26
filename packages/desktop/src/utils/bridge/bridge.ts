// Calls into the app's Rust side (src-tauri/src/lib.rs). The web views never hold the GitHub token:
// they ask for API calls by path and Rust makes them.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { i18n } from "@/utils/i18n/i18n";

export type AuthSource = "keychain" | "gh";

export type AuthStatus = {
  signed_in: boolean;
  source: AuthSource | null;
  login: string | null;
  device_flow: boolean;
  gh_available: boolean;
};

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

/** "pace": what the review time estimate has learned of the reader (estimate.ts). */
export type StoredFile = "config" | "pace";

export type AiStatus = {
  provider: "claude" | "cursor";
  installed: boolean;
  signed_in: boolean;
  version: string | null;
  login_command: string;
};

/** What the AI said, and whether it could read the project or only the diff (and why). */
export type AiAnswer = { text: string; project: boolean; note?: string };

/** The pull request an action runs on. */
export type ActionContext = { number: number; repo: string; title: string; url: string; author: string; me: string };

/** A comment for your pending review, as Rust keeps it until GitHub takes it (drafts.rs). */
export type DraftPut = {
  key: string;
  pull: string;
  path: string;
  line: number;
  side: "additions" | "deletions";
  startLine?: number;
  startSide?: "additions" | "deletions";
  file?: boolean;
  body: string;
  id?: string;
  replyTo?: string;
};
export type DraftChange = ({ op: "put" } & DraftPut) | { op: "remove"; key: string; pull: string; id?: string | null };
/** A pull request's pending comments still on their way (with why GitHub refused one), and
 *  GitHub's id for each that arrived, by key. */
export type DraftsState = { jobs: Array<{ change: DraftChange; error: string | null }>; ids: Record<string, string> };

/** A picture or video on github.com, for a comment (src-tauri/src/uploads.rs). */
export type Uploaded = { href: string; kind: "image" | "video" };
/** Why it wasn't uploaded: nobody signed in on github.com, the session ended, or GitHub's words. */
export type UploadError = { kind: "not_signed_in" } | { kind: "session_expired" } | { kind: "failed"; message: string };

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ReviewPull = {
  id: string;
  number: number;
  title: string;
  repository: { nameWithOwner: string };
  author: { login: string; name?: string | null } | null;
};

/** The author as a window's title names them: their first name, else their login. */
const byline = (author: ReviewPull["author"]) => (author?.name ?? "").trim().split(/\s+/u)[0]! || (author?.login ?? "");

const reviewArgs = (pr: ReviewPull, teams: string[], queue?: string | null) => ({
  id: pr.id,
  repo: pr.repository.nameWithOwner,
  number: pr.number,
  teams,
  queue: queue ?? null,
  title: `#${pr.number} · ${pr.title} · ${byline(pr.author)}`,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export const bridge = {
  /** Marks a file viewed, or not, on github.com: Rust keeps it until GitHub takes it (outbox.rs).
   *  `pull`: the pull request's node id. */
  queueViewed: (pull: string, path: string, viewed: boolean) => invoke<void>("queue_viewed", { pull, path, viewed }),
  /** The marks still on their way for a pull request, by path. */
  queuedViewed: (pull: string) => invoke<Record<string, boolean>>("queued_viewed", { pull }),

  /** Your pending review's comments go to GitHub through Rust, which keeps them until it takes
   *  them (drafts.rs); a "drafts" event says one went. `pull`: the pull request's node id. */
  draftPut: (put: DraftPut) => invoke<void>("drafts_put", { put }),
  draftRemove: (pull: string, key: string, id?: string) => invoke<void>("drafts_remove", { pull, key, id: id ?? null }),
  draftsState: (pull: string) => invoke<DraftsState>("drafts_state", { pull }),
  draftsRetry: (pull: string) => invoke<void>("drafts_retry", { pull }),
  /** After the review is sent or thrown away. */
  draftsForget: (pull: string) => invoke<void>("drafts_forget", { pull }),
  /** Resolves once every pending comment is on GitHub; rejects with what GitHub refused. */
  draftsFlush: (pull: string) => invoke<void>("drafts_flush", { pull }),

  readFile: (name: StoredFile) => invoke<string | null>("read_file", { name }),
  writeFile: (name: StoredFile, contents: string) => invoke<void>("write_file", { name, contents }),

  authStatus: () => invoke<AuthStatus>("auth_status"),
  authUseGh: () => invoke<void>("auth_use_gh"),
  authUseToken: (token: string) => invoke<void>("auth_use_token", { token }),
  authDeviceStart: () => invoke<DeviceCode>("auth_device_start"),
  authDeviceFinish: (code: DeviceCode) =>
    invoke<void>("auth_device_finish", {
      deviceCode: code.device_code,
      interval: code.interval,
      expiresIn: code.expires_in,
    }),
  authSignOut: () => invoke<void>("auth_sign_out"),

  /** Who's signed in on github.com itself, for attaching files (src-tauri/src/web.rs); a
   *  "web-session" event says when it changes. */
  webSession: () => invoke<string | null>("github_web_session"),
  /** github.com's own sign-in page, in a window of its own. */
  signInWeb: () => invoke<void>("sign_in_web"),
  signOutWeb: () => invoke<void>("sign_out_web"),
  /** Uploads a picture or video as github.com does, for a comment on `repo#number`. The bytes go
   *  as they are; rejects with an UploadError. */
  uploadAttachment: async (repo: string, number: number, file: File) =>
    invoke<Uploaded>("upload_attachment", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-repo": repo, "x-number": String(number), "x-name": encodeURIComponent(file.name) },
    }),

  aiStatuses: () => invoke<AiStatus[]>("ai_statuses"),
  aiModels: (provider: AiStatus["provider"]) => invoke<string[]>("ai_models", { provider }),
  /** `project`: the pull request whose code it may read; `schema`: a JSON Schema the answer follows. */
  /** `run`: an id to stop it by (aiCancel). */
  aiAsk: (q: {
    provider: AiStatus["provider"];
    model: string;
    effort: string;
    prompt: string;
    input: string;
    project: { repo: string; number: number; head: string } | null;
    schema: string | null;
    run?: string;
  }) => invoke<AiAnswer>("ai_ask", { ...q, model: q.model || null, effort: q.effort || null, run: q.run ?? null }),
  aiCancel: (run: string) => invoke<void>("ai_cancel", { run }),
  /** Fetches a pull request's code in the background, so questions about it can read it at once. */
  aiPrepare: (project: { repo: string; number: number; head: string }) => invoke<void>("ai_prepare", { project }),

  /** Runs a "run" step of a saved action: Rust reads the command from the config and asks first. */
  runAction: (action: { id: string; name: string }, step: number, pr: ActionContext) =>
    invoke<string>("run_action", { action: action.id, name: action.name, step, pr }),

  /** The queues' live state, kept by Rust (src-tauri/src/watch.rs); changes come as "snapshot" events. */
  snapshot: <T>() => invoke<T>("snapshot"),
  /** Without `force`, only if the last refresh is older than the configured rhythm. */
  refresh: (force = false) => invoke<void>("refresh", { force }),
  markSeen: (queueId: string, prId: string) => invoke<void>("mark_seen", { queueId, prId }),
  markQueueSeen: (queueId: string) => invoke<void>("mark_queue_seen", { queueId }),
  dismiss: (queueId: string, prId: string) => invoke<void>("dismiss", { queueId, prId }),
  restore: (queueId: string, prId: string) => invoke<void>("restore", { queueId, prId }),
  clearArrival: (prId: string) => invoke<void>("clear_arrival", { prId }),
  /** Ends the review time under way before its time is up. */
  endReview: () => invoke<void>("end_review"),

  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openSettings: () => invoke<void>("open_settings"),
  openSetup: () => invoke<void>("open_setup"),
  /** Shows the panel under the tray icon, as a click on it would. */
  openPanel: () => invoke<void>("open_panel"),
  /** A pull request's review window: its overview, conversation and diff. `teams`: the ones its
   *  review was asked of on your behalf, for leaving the review. */
  /** `from`: the card clicked, so the window grows out of it. `queue`: the queue it was opened
   *  from, whose next one the window offers. */
  openReview: (pr: ReviewPull, teams: string[] = [], from?: DOMRect, queue?: string) =>
    invoke<void>("open_review", {
      from: from && { x: from.x, y: from.y, width: from.width, height: from.height },
      ...reviewArgs(pr, teams, queue),
    }),
  /** This review window, on to another pull request of its queue (or to its own window, if open). */
  switchReview: (pr: ReviewPull, teams: string[], queue: string | null) =>
    invoke<void>("switch_review", reviewArgs(pr, teams, queue)),
  /** A newer version, if there is one (checking GitHub's releases now). */
  checkUpdate: () => invoke<string | null>("check_update"),
  /** The newer version found by the last check, if any. */
  updateOffered: () => invoke<string | null>("update_offered"),
  /** Downloads and installs it, then restarts. */
  installUpdate: () => invoke<void>("install_update"),
  hidePanel: () => invoke<void>("hide_panel"),
  /** A native alert on this window (a sheet on the Mac) for something that can't be undone: true
   *  when the person picks `ok`, the default button; Cancel answers Esc. */
  confirm: (title: string, message: string, ok: string) => invoke<boolean>("confirm", { title, message, ok }),
  /** Which of the menu bar's review commands this window can do now (src-tauri/src/menu.rs). */
  menuState: (items: Record<string, boolean>) => invoke<void>("menu_state", { items }),
  quit: () => invoke<void>("quit"),

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload Rust sends
  on: <T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> =>
    listen<T>(event, (e) => {
      handler(e.payload);
    }),
};

/** A GitHub REST or GraphQL call. Throws GitHubError for HTTP errors, with GitHub's message. */
export async function github<T = unknown>(method: string, path: string, body?: unknown, accept?: string): Promise<T> {
  const response = await invoke<{ status: number; body: string }>("github", {
    method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    accept: accept ?? null,
  });
  const parsed = response.body && !accept ? safeJson(response.body) : response.body;
  if (response.status >= 400) {
    const message =
      isRecord(parsed) && typeof parsed.message === "string"
        ? parsed.message
        : i18n()("common.githubReturned", { status: String(response.status) });
    throw new GitHubError(response.status, message);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller names the shape GitHub sends; nothing here can check it
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A GraphQL query. Throws on errors when there's no data at all; partial data comes back as is. */
export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const reply = await github<{ data?: T; errors?: Array<{ message: string }> }>("POST", "/graphql", {
    query,
    variables,
  });
  if (!reply.data) throw new GitHubError(200, reply.errors?.[0]?.message ?? i18n()("common.githubNoData"));
  return reply.data;
}
