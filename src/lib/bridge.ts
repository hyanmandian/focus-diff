// Calls into the app's Rust side (src-tauri/src/lib.rs). The web views never hold the GitHub token:
// they ask for API calls by path and Rust makes them.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

export type StoredFile = "config";

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

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bridge = {
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

  aiStatuses: () => invoke<AiStatus[]>("ai_statuses"),
  aiModels: (provider: AiStatus["provider"]) => invoke<string[]>("ai_models", { provider }),
  /** `project`: the pull request whose code it may read; `schema`: a JSON Schema the answer follows. */
  aiAsk: (q: { provider: AiStatus["provider"]; model: string; effort: string; prompt: string; input: string; project: { repo: string; number: number; head: string } | null; schema: string | null }) =>
    invoke<AiAnswer>("ai_ask", { ...q, model: q.model || null, effort: q.effort || null }),

  /** Runs a "run" step of a saved action: Rust reads the command from the config and asks first. */
  runAction: (action: { id: string; name: string }, step: number, pr: ActionContext) => invoke<string>("run_action", { action: action.id, name: action.name, step, pr }),

  /** The queues' live state, kept by Rust (src-tauri/src/watch.rs); changes come as "snapshot" events. */
  snapshot: <T>() => invoke<T>("snapshot"),
  /** Without `force`, only if the last refresh is older than the configured rhythm. */
  refresh: (force = false) => invoke<void>("refresh", { force }),
  markSeen: (queueId: string, prId: string) => invoke<void>("mark_seen", { queueId, prId }),
  markQueueSeen: (queueId: string) => invoke<void>("mark_queue_seen", { queueId }),
  dismiss: (queueId: string, prId: string) => invoke<void>("dismiss", { queueId, prId }),
  clearArrival: (prId: string) => invoke<void>("clear_arrival", { prId }),

  openUrl: (url: string) => invoke<void>("open_url", { url }),
  openSettings: () => invoke<void>("open_settings"),
  openSetup: () => invoke<void>("open_setup"),
  /** Shows the panel under the tray icon, as a click on it would. */
  openPanel: () => invoke<void>("open_panel"),
  /** A pull request's review window: its overview, conversation and diff. `teams`: the ones its
   *  review was asked of on your behalf, for leaving the review. */
  openReview: (pr: { id: string; number: number; title: string; repository: { nameWithOwner: string }; author: { login: string; name?: string | null } | null }, teams: string[] = []) =>
    invoke<void>("open_review", {
      id: pr.id,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      teams,
      title: `#${pr.number} · ${pr.title} · ${pr.author?.name?.trim().split(/\s+/)[0] || pr.author?.login || ""}`,
    }),
  hidePanel: () => invoke<void>("hide_panel"),
  quit: () => invoke<void>("quit"),

  on: <T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> =>
    listen<T>(event, (e) => handler(e.payload)),
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
    const message = (parsed as { message?: string } | null)?.message ?? `GitHub returned ${response.status}`;
    throw new GitHubError(response.status, message);
  }
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
  const reply = await github<{ data?: T; errors?: Array<{ message: string }> }>("POST", "/graphql", { query, variables });
  if (!reply.data) throw new GitHubError(200, reply.errors?.[0]?.message ?? "GitHub returned no data");
  return reply.data;
}
