import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { authItem, checkPath, createGitHubApi, ETAG_LARGEST, isQuery, RECENT_BUDGET, RECENT_FOR } from "./github-api";

type Answer = { status?: number; body?: string; etag?: string } | Error;
type Asked = { url: string; init: RequestInit };

/** GitHub as a test answers it, one answer per request in order (the last one again once they run out). */
const github = (...answers: Answer[]) => {
  const asked: Asked[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      asked.push({ url, init });
      const answer = answers.length > 1 ? answers.shift()! : answers[0]!;
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(
        new Response(answer.status === 304 || answer.status === 204 ? null : (answer.body ?? ""), {
          status: answer.status ?? 200,
          headers: answer.etag ? { etag: answer.etag } : {},
        }),
      );
    }),
  );
  return asked;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
const header = (asked: Asked, name: string) => (asked.init.headers as Record<string, string> | undefined)?.[name];

beforeEach(async () => {
  await authItem.setValue({ token: "t0ken" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("calls to GitHub's API", () => {
  it("go to the API alone, with the token, and answer GitHub's status and body", async () => {
    const asked = github({ status: 201, body: '{"id":1}' });
    const api = createGitHubApi();
    await expect(api.request("POST", "/repos/acme/web/issues", '{"title":"x"}', null)).resolves.toEqual({
      status: 201,
      body: '{"id":1}',
    });
    expect(asked[0]!.url).toBe("https://api.github.com/repos/acme/web/issues");
    expect(asked[0]!.init.body).toBe('{"title":"x"}');
    expect(header(asked[0]!, "Authorization")).toBe("Bearer t0ken");
    expect(header(asked[0]!, "Accept")).toBe("application/vnd.github+json");
    expect(header(asked[0]!, "Content-Type")).toBe("application/json");
    expect(header(asked[0]!, "X-GitHub-Api-Version")).toBe("2022-11-28");
  });

  it("send a DELETE without a body as one, and with one as one", async () => {
    const asked = github({ status: 204 });
    const api = createGitHubApi();
    await api.request("DELETE", "/a", null, "text/plain");
    await api.request("DELETE", "/b", "{}", null);
    await api.request("PATCH", "/c", null, null);
    expect(asked.map((a) => a.init.body)).toEqual([undefined, "{}", ""]);
    expect(header(asked[0]!, "Accept")).toBe("text/plain");
  });

  it("refuse other hosts, schemes and methods", async () => {
    const api = createGitHubApi();
    github({});
    for (const path of ["https://evil.com", "//evil.com", "/a\\b"])
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await expect(api.request("GET", path, null, null)).rejects.toThrow("Bad request");
    await expect(api.request("HEAD", "/user", null, null)).rejects.toThrow("Bad request");
    expect(() => {
      checkPath("/ok");
    }).not.toThrow();
  });

  it("say when GitHub can't be reached, or no one is signed in", async () => {
    github(new Error("offline"));
    const api = createGitHubApi();
    await expect(api.request("GET", "/user", null, null)).rejects.toThrow("Couldn't reach GitHub: offline");
    github(new Error("offline"));
    await authItem.removeValue();
    await expect(createGitHubApi().request("GET", "/user", null, null)).rejects.toThrow("Not signed in to GitHub");
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    await expect(createGitHubApi().request("GET", "/user", null, null)).rejects.toThrow(
      "Você não está conectado ao GitHub",
    );
  });

  it("say a thrown thing that isn't an Error as it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("down")),
    );
    await expect(createGitHubApi().request("GET", "/user", null, null)).rejects.toThrow("Couldn't reach GitHub: down");
  });

  it("ask again with GitHub's tag, and use what's kept when nothing changed", async () => {
    const asked = github({ body: "first", etag: '"v1"' }, { status: 304 }, { body: "second", etag: '"v2"' });
    const api = createGitHubApi();
    await expect(api.request("GET", "/repos/acme/web", null, null)).resolves.toEqual({ status: 200, body: "first" });
    await expect(api.request("GET", "/repos/acme/web", null, null)).resolves.toEqual({ status: 200, body: "first" });
    await expect(api.request("GET", "/repos/acme/web", null, null)).resolves.toEqual({ status: 200, body: "second" });
    expect(asked.map((a) => header(a, "If-None-Match"))).toEqual([undefined, '"v1"', '"v1"']);
    expect(asked[0]!.init.cache).toBe("no-store");
  });

  it("keep no tag for what isn't worth it: errors, untagged and huge answers", async () => {
    const huge = "x".repeat(ETAG_LARGEST + 1);
    const asked = github(
      { status: 404, body: "no", etag: '"a"' },
      { body: "plain" },
      { body: huge, etag: '"b"' },
      { status: 304 },
    );
    const api = createGitHubApi();
    await api.request("GET", "/a", null, null);
    await api.request("GET", "/a", null, null);
    await api.request("GET", "/a", null, null);
    // Not kept: a 304 to a request that had no tag is GitHub's own answer.
    await expect(api.request("GET", "/a", null, null)).resolves.toEqual({ status: 304, body: "" });
    expect(asked.map((a) => header(a, "If-None-Match"))).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("drop the oldest tags past the budget", async () => {
    const big = "x".repeat(ETAG_LARGEST);
    const asked = github({ body: big, etag: '"t"' });
    const api = createGitHubApi();
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
    for (const path of ["/1", "/2", "/3", "/4", "/5", "/1", "/5"]) await api.request("GET", path, null, null);
    expect(asked.slice(5).map((a) => header(a, "If-None-Match"))).toEqual([undefined, '"t"']);
  });
});

describe("a page's calls", () => {
  it("answer the same read from memory for two minutes", async () => {
    vi.useFakeTimers();
    const asked = github({ body: "pull" });
    const api = createGitHubApi();
    await api.requestForPage("GET", "/repos/acme/web/pulls/1", null, null);
    await api.requestForPage("GET", "/repos/acme/web/pulls/1", null, null);
    expect(asked).toHaveLength(1);
    vi.advanceTimersByTime(RECENT_FOR);
    await api.requestForPage("GET", "/repos/acme/web/pulls/1", null, null);
    expect(asked).toHaveLength(2);
  });

  it("count GraphQL queries and Markdown previews as reads, and anything else as a write that forgets them", async () => {
    const asked = github({ body: "{}" });
    const api = createGitHubApi();
    const query = JSON.stringify({ query: " query { viewer { login } }" });
    const short = JSON.stringify({ query: "{ viewer { login } }" });
    for (let i = 0; i < 2; i++) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await api.requestForPage("POST", "/graphql", query, null);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await api.requestForPage("POST", "/graphql", short, null);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await api.requestForPage("POST", "/markdown", '{"text":"hi"}', null);
    }
    expect(asked).toHaveLength(3);
    await api.requestForPage("POST", "/graphql", JSON.stringify({ query: "mutation { x }" }), null);
    await api.requestForPage("POST", "/graphql", query, null);
    expect(asked).toHaveLength(5);
  });

  it("keep only answers that worked, within the budget", async () => {
    const asked = github({ status: 500, body: "down" }, { body: "x".repeat(RECENT_BUDGET / 2) });
    const api = createGitHubApi();
    await api.requestForPage("GET", "/a", null, null);
    await api.requestForPage("GET", "/a", null, null);
    await api.requestForPage("GET", "/b", null, null);
    await api.requestForPage("GET", "/c", null, null);
    await api.requestForPage("GET", "/a", null, null);
    await api.requestForPage("GET", "/c", null, null);
    expect(asked.map((a) => a.url.slice(-2))).toEqual(["/a", "/a", "/b", "/c", "/a"]);
  });

  it("tell a query from what isn't one", () => {
    expect(isQuery(null)).toBe(false);
    expect(isQuery("not json")).toBe(false);
    expect(isQuery("{}")).toBe(false);
    expect(isQuery("1")).toBe(false);
  });
});

describe("bytes and redirects", () => {
  it("fetch a file's bytes, up to a size", async () => {
    const asked = github({ body: "abc" });
    const api = createGitHubApi();
    const got = await api.bytes("/repos/acme/web/contents/a", "application/vnd.github.raw+json", 10);
    expect([got.status, new TextDecoder().decode(got.bytes)]).toEqual([200, "abc"]);
    expect(header(asked[0]!, "Accept")).toBe("application/vnd.github.raw+json");
    await expect(api.bytes("/a", "x", 2)).rejects.toThrow("The file is too large to show");
    await expect(api.bytes("//evil", "x", 2)).rejects.toThrow("Bad request");
    github(new Error("offline"));
    await expect(api.bytes("/a", "x", 2)).rejects.toThrow("Couldn't reach GitHub");
  });

  it("follow a redirect", async () => {
    const asked = github({ body: "log" });
    const response = await createGitHubApi().follow("/repos/acme/web/actions/jobs/1/logs");
    expect(await response.text()).toBe("log");
    expect(asked[0]!.init.redirect).toBe("follow");
    await expect(createGitHubApi().follow("//x")).rejects.toThrow("Bad request");
  });
});

describe("who's signed in", () => {
  it("is asked of GitHub once, then known", async () => {
    const asked = github({ body: '{"login":"ana"}' });
    const api = createGitHubApi();
    await expect(api.login()).resolves.toBe("ana");
    await expect(api.login()).resolves.toBe("ana");
    expect(asked).toHaveLength(1);
    await expect(api.status()).resolves.toEqual({
      signed_in: true,
      source: "keychain",
      login: "ana",
      device_flow: false,
      gh_available: false,
    });
  });

  it("is nobody without a token, with one GitHub refuses, or an answer without a login", async () => {
    github({ status: 401 });
    await expect(createGitHubApi().login()).resolves.toBeNull();
    github({ body: "{}" });
    await expect(createGitHubApi().login()).resolves.toBeNull();
    github({ body: "null" });
    await expect(createGitHubApi().login()).resolves.toBeNull();
    await authItem.removeValue();
    vi.stubEnv("FOCUS_DIFF_GITHUB_CLIENT_ID", "abc");
    await expect(createGitHubApi().status()).resolves.toEqual({
      signed_in: false,
      source: null,
      login: null,
      device_flow: true,
      gh_available: false,
    });
  });

  it("can't be told while GitHub is having trouble", async () => {
    github({ status: 502 });
    const api = createGitHubApi();
    await expect(api.login()).rejects.toThrow("GitHub returned 502");
    await expect(api.status()).resolves.toMatchObject({ signed_in: false });
  });
});

describe("signing in and out", () => {
  it("keeps a token GitHub accepts, and tells whoever listens", async () => {
    await authItem.removeValue();
    const asked = github({ body: '{"login":"ana"}' });
    const api = createGitHubApi();
    const heard = vi.fn<() => void>();
    api.onChange(heard);
    await api.useToken("  ghp_new \n");
    expect(header(asked[0]!, "Authorization")).toBe("Bearer ghp_new");
    await expect(authItem.getValue()).resolves.toEqual({ token: "ghp_new" });
    expect(heard).toHaveBeenCalledTimes(1);
    await api.signOut();
    await expect(authItem.getValue()).resolves.toBeNull();
    await expect(api.login()).resolves.toBeNull();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("forgets what it knew of the last account", async () => {
    const asked = github({ body: '{"login":"ana"}', etag: '"u"' });
    const api = createGitHubApi();
    await api.login();
    await api.useToken("ghp_other");
    await api.request("GET", "/user", null, null);
    expect(header(asked[2]!, "If-None-Match")).toBeUndefined();
  });

  it("turns down what isn't a token, or one GitHub won't take", async () => {
    const api = createGitHubApi();
    await expect(api.useToken("  ")).rejects.toThrow("That doesn't look like a token");
    await expect(api.useToken("a b")).rejects.toThrow("That doesn't look like a token");
    github({ status: 401 });
    await expect(api.useToken("ghp_bad")).rejects.toThrow("GitHub didn't accept that token");
    await expect(authItem.getValue()).resolves.toEqual({ token: "t0ken" });
  });
});

describe("signing in with a code", () => {
  it("isn't there without the OAuth app's client id", async () => {
    const api = createGitHubApi();
    await expect(api.deviceStart()).rejects.toThrow("Signing in with GitHub isn't set up in this build");
    await expect(api.deviceFinish("d", 5, 900)).rejects.toThrow("isn't set up");
  });

  it("asks GitHub for a code, with what it reads", async () => {
    vi.stubEnv("FOCUS_DIFF_GITHUB_CLIENT_ID", "client");
    const asked = github({
      body: JSON.stringify({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://x", interval: 7 }),
    });
    await expect(createGitHubApi().deviceStart()).resolves.toEqual({
      device_code: "dc",
      user_code: "ABCD-1234",
      verification_uri: "https://x",
      interval: 7,
      expires_in: 900,
    });
    expect(asked[0]!.url).toBe("https://github.com/login/device/code");
    expect(asked[0]!.init.body).toBe("client_id=client&scope=repo+read%3Aorg+read%3Auser");
    github({ body: JSON.stringify({ device_code: "dc", user_code: "u", expires_in: 60 }) });
    await expect(createGitHubApi().deviceStart()).resolves.toMatchObject({
      verification_uri: "https://github.com/login/device",
      interval: 5,
      expires_in: 60,
    });
    github({ body: "{}" });
    await expect(createGitHubApi().deviceStart()).rejects.toThrow("GitHub didn't send a code");
    github({ body: "null" });
    await expect(createGitHubApi().deviceStart()).rejects.toThrow("GitHub didn't send a code");
    github(new Error("offline"));
    await expect(createGitHubApi().deviceStart()).rejects.toThrow("Couldn't reach GitHub");
  });

  it("waits for the person, slowing down when asked, and keeps the token", async () => {
    vi.useFakeTimers();
    vi.stubEnv("FOCUS_DIFF_GITHUB_CLIENT_ID", "client");
    await authItem.removeValue();
    const asked = github(
      { body: '{"error":"authorization_pending"}' },
      { body: '{"error":"slow_down"}' },
      { body: '{"access_token":"gho_x"}' },
    );
    const api = createGitHubApi();
    const heard = vi.fn<() => void>();
    api.onChange(heard);
    const done = api.deviceFinish("dc", 5, 900);
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(asked[0]!.init.body).toContain("grant_type=urn%3Aietf");
    await expect(authItem.getValue()).resolves.toEqual({ token: "gho_x" });
    expect(heard).toHaveBeenCalled();
  });

  it("says why it stopped", async () => {
    vi.useFakeTimers();
    vi.stubEnv("FOCUS_DIFF_GITHUB_CLIENT_ID", "client");
    const api = createGitHubApi();
    const outcome = async (reply: Answer, expiresIn = 900) => {
      github(reply);
      const done = api.deviceFinish("dc", 1, expiresIn).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(2000);
      return String(await done);
    };
    expect(await outcome({ body: '{"error":"expired_token"}' })).toContain("The code expired: start again");
    expect(await outcome({ body: '{"error":"access_denied"}' })).toContain("Signing in was cancelled on GitHub");
    expect(await outcome({ body: '{"error":"bad_verification_code"}' })).toContain("GitHub: bad_verification_code");
    expect(await outcome({ body: "{}" })).toContain("Unexpected reply from GitHub");
    expect(await outcome({ body: '{"error":"authorization_pending"}' }, 1)).toContain("The code expired");
  });
});
