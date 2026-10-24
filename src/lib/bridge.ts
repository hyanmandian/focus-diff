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

export type StoredFile = "config" | "state";

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

  notify: (title: string, body: string) => invoke<void>("notify", { title, body }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  trayUpdate: (count: number, animate: boolean) => invoke<void>("tray_update", { count, animate }),
  openSettings: () => invoke<void>("open_settings"),
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
