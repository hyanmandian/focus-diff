import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { Sender } from "@/utils/command-server/command-server";
import { authItem, createGitHubApi } from "@/utils/github-api/github-api";

import { readPut, startGitHubCommands } from "./github-commands";

const page: Sender = { window: "review-1" };
const SHA = "c".repeat(40);

/** GitHub answering `answer` for every request; the requests are kept. */
const github = (answer: (url: string, init: RequestInit) => { status?: number; body?: string }) => {
  const asked: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      asked.push({ url, init });
      const { status = 200, body = "" } = answer(url, init);
      return Promise.resolve(new Response(body, { status }));
    }),
  );
  return asked;
};

const start = async () => {
  const emit = vi.fn<(event: string, payload: unknown) => void>();
  const commands = await startGitHubCommands(createGitHubApi(), emit);
  const run = (command: string, args: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => commands[command]!(args, page));
  return { commands, run, emit };
};

beforeEach(async () => {
  await authItem.setValue({ token: "t0ken" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the GitHub commands", () => {
  it("are every one the app sends", async () => {
    github(() => ({}));
    const { commands } = await start();
    expect(Object.keys(commands).toSorted()).toEqual(
      [
        "github",
        "github_file",
        "job_log",
        "auth_status",
        "auth_use_gh",
        "auth_use_token",
        "auth_device_start",
        "auth_device_finish",
        "auth_sign_out",
        "queue_viewed",
        "queued_viewed",
        "drafts_put",
        "drafts_remove",
        "drafts_state",
        "drafts_retry",
        "drafts_forget",
        "drafts_flush",
        "kept_read",
        "kept_write",
        "github_web_session",
        "sign_in_web",
        "sign_out_web",
        "upload_attachment",
      ].toSorted(),
    );
  });

  it("call GitHub's API for a page", async () => {
    const asked = github(() => ({ status: 201, body: "{}" }));
    const { run } = await start();
    await expect(
      run("github", { method: "POST", path: "/repos/acme/web/issues/1/comments", body: '{"body":"hi"}', accept: null }),
    ).resolves.toEqual({
      status: 201,
      body: "{}",
    });
    expect(asked[0]!.init.body).toBe('{"body":"hi"}');
    await expect(run("github", {})).rejects.toThrow("Bad request");
  });

  it("fetch a file at a commit and a job's log", async () => {
    github((url) => ({ body: url.includes("/contents/") ? "file" : "log line\n" }));
    const { run } = await start();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
    const file = (await run("github_file", { repo: "acme/web", sha: SHA, path: "a.ts" })) as Uint8Array;
    expect(new TextDecoder().decode(file)).toBe("file");
    await expect(run("job_log", { owner: "acme", repo: "web", job: 3, done: true })).resolves.toEqual({
      text: "log line\n",
      truncated: false,
    });
    await expect(run("job_log", { owner: "acme", repo: "web", job: "3", done: false })).rejects.toThrow("Bad request");
  });

  it("sign in with a token or a code, say who's in, and sign out", async () => {
    vi.stubEnv("FOCUS_DIFF_GITHUB_CLIENT_ID", "client");
    github((url) => ({
      body: url.endsWith("/device/code")
        ? JSON.stringify({ device_code: "dc", user_code: "ABCD" })
        : url.endsWith("/access_token")
          ? JSON.stringify({ error: "access_denied" })
          : JSON.stringify({ login: "ana" }),
    }));
    const { run } = await start();
    await run("auth_use_token", { token: "ghp_x" });
    await expect(run("auth_status")).resolves.toMatchObject({ signed_in: true, login: "ana", gh_available: false });
    await expect(run("auth_device_start")).resolves.toMatchObject({ user_code: "ABCD" });
    await expect(run("auth_device_finish", { deviceCode: "dc", interval: 0, expiresIn: 60 })).rejects.toThrow(
      "Signing in was cancelled on GitHub",
    );
    await run("auth_sign_out");
    await expect(authItem.getValue()).resolves.toBeNull();
    await expect(run("auth_use_gh")).rejects.toThrow("The GitHub CLI can't be used from a browser");
    vi.unstubAllEnvs();
  });

  it("send viewed marks and say which are still on their way", async () => {
    let answer: (v: { status: number; body: string }) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = (v) => {
              resolve(new Response(v.body, { status: v.status }));
            };
          }),
      ),
    );
    const { run } = await start();
    await run("queue_viewed", { pull: "PR_1", path: "a.ts", viewed: true });
    await expect(run("queued_viewed", { pull: "PR_1" })).resolves.toEqual({ "a.ts": true });
    answer({ status: 200, body: JSON.stringify({ data: { markFileAsViewed: {} } }) });
    await vi.waitFor(() => expect(run("queued_viewed", { pull: "PR_1" })).resolves.toEqual({}));
  });

  it("keep pending review comments on their way and tell the page", async () => {
    github(() => ({ body: JSON.stringify({ data: {} }) }));
    const { run, emit } = await start();
    await run("drafts_put", {
      put: { key: "k", pull: "PR_1", path: "a.ts", line: 1, side: "additions", body: "hi", id: "C_1" },
    });
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith("drafts", "PR_1");
    });
    await expect(run("drafts_state", { pull: "PR_1" })).resolves.toEqual({ jobs: [], ids: { k: "C_1" } });
    await run("drafts_flush", { pull: "PR_1" });
    await run("drafts_remove", { pull: "PR_1", key: "k", id: null });
    await run("drafts_retry", { pull: "PR_1" });
    await run("drafts_forget", { pull: "PR_1" });
    await expect(run("drafts_state", { pull: "PR_1" })).resolves.toEqual({ jobs: [], ids: {} });
    await expect(run("drafts_put", { put: null })).rejects.toThrow("Bad request");
  });

  it("keep each review's last copy", async () => {
    github(() => ({}));
    const { run } = await start();
    await run("kept_write", { id: "PR_1", contents: "{}" });
    await expect(run("kept_read", { id: "PR_1" })).resolves.toBe("{}");
  });

  it("say github.com's own sign-in and uploads aren't here", async () => {
    github(() => ({}));
    const { run } = await start();
    await expect(run("github_web_session")).resolves.toBeNull();
    await expect(run("sign_in_web")).resolves.toBeNull();
    await expect(run("sign_out_web")).resolves.toBeNull();
    await expect(run("upload_attachment", { bytes: { $bytes: "" } })).rejects.toEqual({
      kind: "failed",
      message: "Attaching pictures and videos needs Focus Diff for Mac",
    });
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    await expect(run("upload_attachment")).rejects.toMatchObject({
      message: "Anexar imagens e vídeos precisa do Focus Diff para Mac",
    });
  });
});

describe("a comment as the page sends it", () => {
  it("is read with what it has", () => {
    expect(
      readPut({
        key: "k",
        pull: "P",
        path: "a.ts",
        line: 4,
        side: "deletions",
        startLine: 2,
        startSide: "additions",
        file: true,
        body: "b",
        id: "C",
        replyTo: "T",
        extra: 1,
      }),
    ).toEqual({
      key: "k",
      pull: "P",
      path: "a.ts",
      line: 4,
      side: "deletions",
      startLine: 2,
      startSide: "additions",
      file: true,
      body: "b",
      id: "C",
      replyTo: "T",
    });
    expect(readPut({ key: "k", pull: "P", path: "a", line: 1, side: "?", body: "" })).toEqual({
      key: "k",
      pull: "P",
      path: "a",
      line: 1,
      side: "additions",
      body: "",
    });
  });

  it("is turned down when it isn't one", () => {
    expect(() => readPut("x")).toThrow("Bad request");
    expect(() => readPut({ key: "k", pull: "P", path: "a", line: "1", body: "" })).toThrow("Bad request");
    expect(() => readPut({ key: 1, pull: "P", path: "a", line: 1, body: "" })).toThrow("Bad request");
  });
});
