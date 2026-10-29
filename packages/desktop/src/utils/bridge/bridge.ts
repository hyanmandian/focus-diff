import { i18n } from "@/utils/i18n/i18n";
import { invoke, platform } from "@/utils/platform/platform";

export type AuthSource = "keychain" | "gh";

export type AuthStatus = {
  signed_in: boolean;
  source: AuthSource | null;
  login: string | null;
  device_flow: boolean;
  gh_available: boolean;
  gh_signed_in: boolean;
};

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

type StoredFile = "config" | "pace";

export type AiStatus = {
  provider: "claude" | "cursor";
  installed: boolean;
  signed_in: boolean;
  version: string | null;
  login_command: string;
};

export type AiUsage = {
  input: number;
  cacheCreated: number;
  cacheRead: number;
  output: number;
  cost: number;
  ms: number;
};

export type AiAnswer = { text: string; project: boolean; note?: string; usage?: AiUsage; resumed?: boolean };

export type ActionContext = { number: number; repo: string; title: string; url: string; author: string; me: string };

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
export type DraftsState = { jobs: Array<{ change: DraftChange; error: string | null }>; ids: Record<string, string> };

type Uploaded = { href: string; kind: "image" | "video" };
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

const byline = (author: ReviewPull["author"]) => (author?.name ?? "").trim().split(/\s+/u)[0]! || (author?.login ?? "");

const reviewArgs = (pr: ReviewPull, teams: string[], queue?: string | null) => ({
  id: pr.id,
  repo: pr.repository.nameWithOwner,
  number: pr.number,
  teams,
  queue: queue ?? null,
  title: `#${pr.number} · ${pr.title} · ${byline(pr.author)}`,
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const bridge = {
  queueViewed: (pull: string, path: string, viewed: boolean) => invoke<void>("queue_viewed", { pull, path, viewed }),
  queuedViewed: (pull: string) => invoke<Record<string, boolean>>("queued_viewed", { pull }),

  draftPut: (put: DraftPut) => invoke<void>("drafts_put", { put }),
  draftRemove: (pull: string, key: string, id?: string) => invoke<void>("drafts_remove", { pull, key, id: id ?? null }),
  draftsState: (pull: string) => invoke<DraftsState>("drafts_state", { pull }),
  draftsRetry: (pull: string) => invoke<void>("drafts_retry", { pull }),
  draftsForget: (pull: string) => invoke<void>("drafts_forget", { pull }),
  draftsFlush: (pull: string) => invoke<void>("drafts_flush", { pull }),

  readFile: (name: StoredFile) => invoke<string | null>("read_file", { name }),
  writeFile: (name: StoredFile, contents: string) => invoke<void>("write_file", { name, contents }),

  authStatus: () => invoke<AuthStatus>("auth_status"),
  authUseGh: () => invoke<void>("auth_use_gh"),
  authUseToken: (token: string) => invoke<void>("auth_use_token", { token }),
  authDeviceStart: () => invoke<DeviceCode>("auth_device_start"),
  authDeviceCancel: () => invoke<void>("auth_device_cancel"),
  authDeviceFinish: (code: DeviceCode) =>
    invoke<void>("auth_device_finish", {
      deviceCode: code.device_code,
      interval: code.interval,
      expiresIn: code.expires_in,
    }),
  authSignOut: () => invoke<void>("auth_sign_out"),

  webSession: () => invoke<string | null>("github_web_session"),
  signInWeb: () => invoke<void>("sign_in_web"),
  signOutWeb: () => invoke<void>("sign_out_web"),
  uploadAttachment: async (repo: string, number: number, file: File) =>
    invoke<Uploaded>("upload_attachment", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-repo": repo, "x-number": String(number), "x-name": encodeURIComponent(file.name) },
    }),

  aiStatuses: () => invoke<AiStatus[]>("ai_statuses"),
  aiModels: (provider: AiStatus["provider"]) => invoke<string[]>("ai_models", { provider }),
  aiAsk: (q: {
    provider: AiStatus["provider"];
    model: string;
    effort: string;
    system: string;
    material: string;
    task: string;
    recap: string;
    project: { repo: string; number: number; head: string } | null;
    schema: string | null;
    session: boolean;
    ownSettings: boolean;
    run?: string;
  }) => invoke<AiAnswer>("ai_ask", { ...q, model: q.model || null, effort: q.effort || null, run: q.run ?? null }),
  aiCancel: (run: string) => invoke<void>("ai_cancel", { run }),
  aiPrepare: (project: { repo: string; number: number; head: string }) => invoke<void>("ai_prepare", { project }),

  runAction: (action: { id: string; name: string }, step: number, pr: ActionContext) =>
    invoke<string>("run_action", { action: action.id, name: action.name, step, pr }),

  snapshot: <T>() => invoke<T>("snapshot"),
  refresh: (force = false) => invoke<void>("refresh", { force }),
  markSeen: (queueId: string, prId: string) => invoke<void>("mark_seen", { queueId, prId }),
  markQueueSeen: (queueId: string) => invoke<void>("mark_queue_seen", { queueId }),
  dismiss: (queueId: string, prId: string) => invoke<void>("dismiss", { queueId, prId }),
  reviewed: (prId: string) => invoke<void>("reviewed", { prId }),
  testNotification: (sound: boolean) => invoke<void>("test_notification", { sound }),
  restore: (queueId: string, prId: string) => invoke<void>("restore", { queueId, prId }),
  clearArrival: (prId: string) => invoke<void>("clear_arrival", { prId }),
  endReview: () => invoke<void>("end_review"),

  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openSettings: () => invoke<void>("open_settings"),
  openSetup: () => invoke<void>("open_setup"),
  openPanel: () => invoke<void>("open_panel"),
  reportProblem: () => invoke<void>("report_problem"),
  takeLink: () => invoke<string | null>("take_link"),
  installCli: () => invoke<string>("install_cli"),
  cliInstalled: () => invoke<string | null>("cli_installed"),
  openReview: (pr: ReviewPull, teams: string[] = [], from?: DOMRect, queue?: string) =>
    invoke<void>("open_review", {
      from: from && { x: from.x, y: from.y, width: from.width, height: from.height },
      ...reviewArgs(pr, teams, queue),
    }),
  switchReview: (pr: ReviewPull, teams: string[], queue: string | null) =>
    invoke<void>("switch_review", reviewArgs(pr, teams, queue)),
  checkUpdate: () => invoke<string | null>("check_update"),
  updateOffered: () => invoke<string | null>("update_offered"),
  installUpdate: () => invoke<void>("install_update"),
  hidePanel: () => invoke<void>("hide_panel"),
  confirm: (title: string, message: string, ok: string) => invoke<boolean>("confirm", { title, message, ok }),
  menuState: (items: Record<string, boolean>) => invoke<void>("menu_state", { items }),
  quit: () => invoke<void>("quit"),

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload Rust sends
  on: <T>(event: string, handler: (payload: T) => void) => {
    const off = platform().listen<T>(event, handler);
    return () => {
      void off.then((stop) => {
        stop();
      });
    };
  },
};

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

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const reply = await github<{ data?: T; errors?: Array<{ message: string }> }>("POST", "/graphql", {
    query,
    variables,
  });
  if (!reply.data) throw new GitHubError(200, reply.errors?.[0]?.message ?? i18n()("common.githubNoData"));
  return reply.data;
}
