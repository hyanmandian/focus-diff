// GitHub access, as the desktop's github.rs: the token never reaches the pages. They ask for API calls by path and
// the background makes them with the token kept in the browser's local storage. Only api.github.com is ever called
// with it.
//
// Signing in uses GitHub's device flow (no server of ours, no redirect): the page shows a code, the person enters it
// on github.com, and the background picks up the token. A pasted token works too.

import type { AuthStatus, DeviceCode } from "@focus-diff/app/utils/bridge";

import { storage } from "#imports";
import { isRecord } from "@/utils/record/record";
import { tr } from "@/utils/words/words";

export const API = "https://api.github.com";
/** Read pull requests, comment and review on them, and read team membership (for team review requests) and your
 *  profile (for your saved replies). Nothing to do with admin. */
export const SCOPES = "repo read:org read:user";
export const API_VERSION = "2022-11-28";

/** Where the token is kept. */
export const authItem = storage.defineItem<{ token: string } | null>("local:auth", { fallback: null });

/** An answer from GitHub, for a page to read. */
export type Reply = { status: number; body: string };

const MB = 1024 * 1024;
/** The pages' reads answered in the last two minutes, kept whole: what the panel fetched ahead the review gets at
 *  once, with no request. Any write clears them, so nothing shown is older than what the person just did. */
export const RECENT_FOR = 120_000;
export const RECENT_BUDGET = 32 * MB;
/** GET answers GitHub tagged: asked again with the tag, GitHub answers 304 without the body (faster, and free against
 *  the rate limit), and the kept body is used. */
export const ETAG_BUDGET = 16 * MB;
export const ETAG_LARGEST = 4 * MB;

/** The client id of the OAuth app the build was made with; empty when there's none. */
const clientId = (): string => import.meta.env.FOCUS_DIFF_GITHUB_CLIENT_ID ?? "";

const unreachable = (error: unknown) => {
  const e = error instanceof Error ? error.message : String(error);
  return new Error(tr(`Couldn't reach GitHub: ${e}`, `Não foi possível falar com o GitHub: ${e}`));
};

export const returned = (status: number) => tr(`GitHub returned ${status}`, `O GitHub respondeu ${status}`);

/** Only ever the API, whatever path a page sends: no other host, no scheme tricks. */
export const checkPath = (path: string) => {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new Error("Bad request");
};

/** A GraphQL request that only reads: a query, not a mutation. */
export const isQuery = (body: string | null): boolean => {
  try {
    const parsed: unknown = JSON.parse(body ?? "");
    const query = isRecord(parsed) ? parsed.query : null;
    if (typeof query !== "string") return false;
    const start = query.trimStart();
    return start.startsWith("query") || start.startsWith("{");
  } catch {
    return false;
  }
};

/** Kept answers, by key, the oldest first: dropped oldest first when over `budget`. */
class Kept<T extends { body: string }> {
  private readonly entries = new Map<string, T>();
  private bytes = 0;

  public constructor(private readonly budget: number) {}

  public get(key: string): T | undefined {
    return this.entries.get(key);
  }

  public put(key: string, entry: T) {
    this.delete(key);
    this.entries.set(key, entry);
    this.bytes += entry.body.length;
    for (const [oldest] of this.entries) {
      if (this.bytes <= this.budget) break;
      this.delete(oldest);
    }
  }

  public delete(key: string) {
    const old = this.entries.get(key);
    if (!old) return;
    this.entries.delete(key);
    this.bytes -= old.body.length;
  }

  public clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

const headers = (token: string, accept: string | null, json: boolean) => ({
  Authorization: `Bearer ${token}`,
  Accept: accept ?? "application/vnd.github+json",
  "X-GitHub-Api-Version": API_VERSION,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

/** One call to the API with a token: its status, body and ETag. */
const call = async (
  token: string,
  method: string,
  path: string,
  body: string | null,
  accept: string | null,
  ifNoneMatch?: string,
): Promise<Reply & { etag: string | null }> => {
  checkPath(path);
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) throw new Error("Bad request");
  const sends = method !== "GET" && (method !== "DELETE" || body !== null);
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      // GitHub's own tags are what count here, not the browser's cache.
      cache: "no-store",
      headers: { ...headers(token, accept, sends), ...(ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {}) },
      ...(sends ? { body: body ?? "" } : {}),
    });
  } catch (error) {
    throw unreachable(error);
  }
  return { status: response.status, body: await response.text(), etag: response.headers.get("etag") };
};

/** A form to github.com's sign-in endpoints, answered in JSON. */
const postForm = async (url: string, form: Record<string, string>): Promise<Record<string, unknown>> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (error) {
    throw unreachable(error);
  }
  const answer: unknown = await response.json();
  return isRecord(answer) ? answer : {};
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const expired = () => new Error(tr("The code expired: start again", "O código expirou: comece de novo"));

const notSetUp = () =>
  new Error(
    tr("Signing in with GitHub isn't set up in this build", "Entrar com o GitHub não está configurado nesta versão"),
  );

export type GitHubApi = ReturnType<typeof createGitHubApi>;

/** GitHub, as the person signed in. */
export const createGitHubApi = () => {
  let token: string | null = null;
  let login: string | null = null;
  const etags = new Kept<{ etag: string; body: string }>(ETAG_BUDGET);
  const recent = new Kept<{ at: number; status: number; body: string }>(RECENT_BUDGET);
  const listeners = new Set<() => void>();

  /** The token, from memory or storage. */
  const tokenNow = async (): Promise<string> => {
    token ??= (await authItem.getValue())?.token ?? null;
    if (!token) throw new Error(tr("Not signed in to GitHub", "Você não está conectado ao GitHub"));
    return token;
  };

  /** Someone else, or no one, is signed in now: nothing known of the last one is kept. */
  const changed = async (next: string | null) => {
    if (next) await authItem.setValue({ token: next });
    else await authItem.removeValue();
    token = next;
    login = null;
    etags.clear();
    recent.clear();
    for (const listener of listeners) listener();
  };

  /** A call, with GET answers revalidated by their ETag. */
  const request = async (method: string, path: string, body: string | null, accept: string | null): Promise<Reply> => {
    const current = await tokenNow();
    if (method !== "GET") {
      const { status, body: text } = await call(current, method, path, body, accept);
      return { status, body: text };
    }
    const key = `${accept ?? ""}\n${path}`;
    const known = etags.get(key);
    const reply = await call(current, method, path, null, accept, known?.etag);
    if (reply.status === 304 && known) return { status: 200, body: known.body };
    if (reply.status === 200 && reply.etag && reply.body.length <= ETAG_LARGEST)
      etags.put(key, { etag: reply.etag, body: reply.body });
    return { status: reply.status, body: reply.body };
  };

  /** A page's call: reads answered in the last two minutes come from memory; writes go through and clear it.
   *  Rendering Markdown (a comment's preview) changes nothing either. */
  const requestForPage = async (
    method: string,
    path: string,
    body: string | null,
    accept: string | null,
  ): Promise<Reply> => {
    const read =
      method === "GET" || (method === "POST" && ((path === "/graphql" && isQuery(body)) || path === "/markdown"));
    if (!read) {
      recent.clear();
      return request(method, path, body, accept);
    }
    const key = `${method} ${path} ${accept ?? ""} ${body ?? ""}`;
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < RECENT_FOR) return { status: hit.status, body: hit.body };
    recent.delete(key);
    const reply = await request(method, path, body, accept);
    if (reply.status === 200) recent.put(key, { at: Date.now(), ...reply });
    return reply;
  };

  /** Who's signed in: null when no one is (no token, or GitHub refused it); rejects when GitHub can't be reached. */
  const whoIsSignedIn = async (): Promise<string | null> => {
    if (login) return login;
    try {
      await tokenNow();
    } catch {
      return null;
    }
    const { status, body } = await request("GET", "/user", null, null);
    if (status === 401) return null;
    if (status !== 200) throw new Error(returned(status));
    const user: unknown = JSON.parse(body);
    const found = isRecord(user) ? user.login : null;
    login = typeof found === "string" ? found : null;
    return login;
  };

  return {
    request,
    requestForPage,
    login: whoIsSignedIn,

    /** A GET whose answer is bytes, not text (a file at a commit), up to `largest`. */
    bytes: async (path: string, accept: string, largest: number): Promise<{ status: number; bytes: Uint8Array }> => {
      checkPath(path);
      const current = await tokenNow();
      let response: Response;
      try {
        response = await fetch(`${API}${path}`, { headers: headers(current, accept, false) });
      } catch (error) {
        throw unreachable(error);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > largest)
        throw new Error(tr("The file is too large to show", "O arquivo é grande demais para mostrar"));
      return { status: response.status, bytes };
    },

    /** A GET that GitHub answers with a redirect (a job's log), followed: the browser leaves the token out of the
     *  request to where it points, which isn't GitHub's API. */
    follow: async (path: string): Promise<Response> => {
      checkPath(path);
      const current = await tokenNow();
      return fetch(`${API}${path}`, { headers: headers(current, null, false), redirect: "follow" });
    },

    status: async (): Promise<AuthStatus> => {
      const who = await whoIsSignedIn().catch(() => null);
      return {
        signed_in: who !== null,
        source: who === null ? null : "keychain",
        login: who,
        device_flow: clientId() !== "",
        gh_available: false,
      };
    },

    /** A pasted token (classic or fine-grained), checked against GitHub before it's kept. */
    useToken: async (pasted: string) => {
      const trimmed = pasted.trim();
      if (!trimmed || /\s/u.test(trimmed))
        throw new Error(tr("That doesn't look like a token", "Isso não parece um token"));
      const { status } = await call(trimmed, "GET", "/user", null, null);
      if (status !== 200) throw new Error(tr("GitHub didn't accept that token", "O GitHub não aceitou esse token"));
      await changed(trimmed);
    },

    deviceStart: async (): Promise<DeviceCode> => {
      const id = clientId();
      if (!id) throw notSetUp();
      const v = await postForm("https://github.com/login/device/code", { client_id: id, scope: SCOPES });
      const code = (key: string) => {
        const value = v[key];
        if (typeof value !== "string")
          throw new Error(tr("GitHub didn't send a code", "O GitHub não mandou um código"));
        return value;
      };
      return {
        device_code: code("device_code"),
        user_code: code("user_code"),
        verification_uri:
          typeof v.verification_uri === "string" ? v.verification_uri : "https://github.com/login/device",
        interval: typeof v.interval === "number" ? v.interval : 5,
        expires_in: typeof v.expires_in === "number" ? v.expires_in : 900,
      };
    },

    /** Waits for the person to enter the code on github.com, then keeps the token. */
    deviceFinish: async (deviceCode: string, interval: number, expiresIn: number) => {
      const id = clientId();
      if (!id) throw notSetUp();
      const deadline = Date.now() + expiresIn * 1000;
      let wait = interval;
      while (Date.now() < deadline) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling, one ask after another, as GitHub wants
        await sleep(wait * 1000);
        // oxlint-disable-next-line eslint/no-await-in-loop -- polling, one ask after another, as GitHub wants
        const v = await postForm("https://github.com/login/oauth/access_token", {
          client_id: id,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
        if (typeof v.access_token === "string") {
          // oxlint-disable-next-line eslint/no-await-in-loop -- the loop ends here
          await changed(v.access_token);
          return;
        }
        switch (v.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            wait += 5;
            break;
          case "expired_token":
            throw expired();
          case "access_denied":
            throw new Error(tr("Signing in was cancelled on GitHub", "A entrada foi cancelada no GitHub"));
          default:
            if (typeof v.error === "string") throw new Error(`GitHub: ${v.error}`);
            throw new Error(tr("Unexpected reply from GitHub", "Resposta inesperada do GitHub"));
        }
      }
      throw expired();
    },

    signOut: () => changed(null),

    /** Hears every sign-in and sign-out. */
    onChange: (listener: () => void) => {
      listeners.add(listener);
    },
  };
};
