import { describe, expect, it, vi } from "vite-plus/test";

import { bridge, github, GitHubError, graphql, type DeviceCode, type ReviewPull } from "@/utils/bridge/bridge";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";

type Call = { cmd: string; args: unknown };

function rust(answer: (cmd: string, args: unknown) => unknown = () => null) {
  const calls: Call[] = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    return answer(cmd, args);
  });
  return calls;
}

const replying = (status: number, body: string) => () => ({ status, body });

const pr: ReviewPull = {
  id: "PR_1",
  number: 7,
  title: "Fix the cart",
  repository: { nameWithOwner: "acme/web" },
  author: { login: "ana", name: "  Ana Lima " },
};

const code: DeviceCode = {
  device_code: "dc",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  interval: 5,
  expires_in: 900,
};

const project = { repo: "acme/web", number: 7, head: "abc" };

describe("bridge", () => {
  const cases: Array<[string, () => Promise<unknown>, string, unknown]> = [
    [
      "queueViewed",
      () => bridge.queueViewed("P", "a.ts", true),
      "queue_viewed",
      { pull: "P", path: "a.ts", viewed: true },
    ],
    ["queuedViewed", () => bridge.queuedViewed("P"), "queued_viewed", { pull: "P" }],
    [
      "draftPut",
      () => bridge.draftPut({ key: "k", pull: "P", path: "a", line: 1, side: "additions", body: "b" }),
      "drafts_put",
      { put: { key: "k", pull: "P", path: "a", line: 1, side: "additions", body: "b" } },
    ],
    ["draftRemove", () => bridge.draftRemove("P", "k"), "drafts_remove", { pull: "P", key: "k", id: null }],
    [
      "draftRemove with id",
      () => bridge.draftRemove("P", "k", "C1"),
      "drafts_remove",
      { pull: "P", key: "k", id: "C1" },
    ],
    ["draftsState", () => bridge.draftsState("P"), "drafts_state", { pull: "P" }],
    ["draftsRetry", () => bridge.draftsRetry("P"), "drafts_retry", { pull: "P" }],
    ["draftsForget", () => bridge.draftsForget("P"), "drafts_forget", { pull: "P" }],
    ["draftsFlush", () => bridge.draftsFlush("P"), "drafts_flush", { pull: "P" }],
    ["readFile", () => bridge.readFile("config"), "read_file", { name: "config" }],
    ["writeFile", () => bridge.writeFile("pace", "{}"), "write_file", { name: "pace", contents: "{}" }],
    ["authStatus", () => bridge.authStatus(), "auth_status", {}],
    ["authUseGh", () => bridge.authUseGh(), "auth_use_gh", {}],
    ["authUseToken", () => bridge.authUseToken("t"), "auth_use_token", { token: "t" }],
    ["authDeviceStart", () => bridge.authDeviceStart(), "auth_device_start", {}],
    [
      "authDeviceFinish",
      () => bridge.authDeviceFinish(code),
      "auth_device_finish",
      { deviceCode: "dc", interval: 5, expiresIn: 900 },
    ],
    ["authSignOut", () => bridge.authSignOut(), "auth_sign_out", {}],
    ["webSession", () => bridge.webSession(), "github_web_session", {}],
    ["signInWeb", () => bridge.signInWeb(), "sign_in_web", {}],
    ["signOutWeb", () => bridge.signOutWeb(), "sign_out_web", {}],
    ["aiStatuses", () => bridge.aiStatuses(), "ai_statuses", {}],
    ["aiModels", () => bridge.aiModels("cursor"), "ai_models", { provider: "cursor" }],
    [
      "aiAsk with the CLI's defaults",
      () =>
        bridge.aiAsk({
          provider: "claude",
          model: "",
          effort: "",
          system: "s",
          material: "m",
          task: "t",
          recap: "",
          project: null,
          schema: null,
          session: false,
          ownSettings: false,
        }),
      "ai_ask",
      {
        provider: "claude",
        model: null,
        effort: null,
        system: "s",
        material: "m",
        task: "t",
        recap: "",
        project: null,
        schema: null,
        session: false,
        ownSettings: false,
        run: null,
      },
    ],
    [
      "aiAsk with choices",
      () =>
        bridge.aiAsk({
          provider: "claude",
          model: "opus",
          effort: "high",
          system: "s",
          material: "m",
          task: "t",
          recap: "r",
          project,
          schema: "{}",
          session: true,
          ownSettings: true,
          run: "r",
        }),
      "ai_ask",
      {
        provider: "claude",
        model: "opus",
        effort: "high",
        system: "s",
        material: "m",
        task: "t",
        recap: "r",
        project,
        schema: "{}",
        session: true,
        ownSettings: true,
        run: "r",
      },
    ],
    ["aiCancel", () => bridge.aiCancel("r"), "ai_cancel", { run: "r" }],
    ["aiPrepare", () => bridge.aiPrepare(project), "ai_prepare", { project }],
    [
      "runAction",
      () =>
        bridge.runAction({ id: "a1", name: "Deploy" }, 2, {
          number: 7,
          repo: "acme/web",
          title: "t",
          url: "u",
          author: "ana",
          me: "bo",
        }),
      "run_action",
      {
        action: "a1",
        name: "Deploy",
        step: 2,
        pr: { number: 7, repo: "acme/web", title: "t", url: "u", author: "ana", me: "bo" },
      },
    ],
    ["snapshot", () => bridge.snapshot(), "snapshot", {}],
    ["refresh", () => bridge.refresh(), "refresh", { force: false }],
    ["refresh, forced", () => bridge.refresh(true), "refresh", { force: true }],
    ["markSeen", () => bridge.markSeen("q", "P"), "mark_seen", { queueId: "q", prId: "P" }],
    ["markQueueSeen", () => bridge.markQueueSeen("q"), "mark_queue_seen", { queueId: "q" }],
    ["dismiss", () => bridge.dismiss("q", "P"), "dismiss", { queueId: "q", prId: "P" }],
    ["reviewed", () => bridge.reviewed("P"), "reviewed", { prId: "P" }],
    ["takeLink", () => bridge.takeLink(), "take_link", {}],
    ["installCli", () => bridge.installCli(), "install_cli", {}],
    ["cliInstalled", () => bridge.cliInstalled(), "cli_installed", {}],
    ["testNotification", () => bridge.testNotification(true), "test_notification", { sound: true }],
    ["restore", () => bridge.restore("q", "P"), "restore", { queueId: "q", prId: "P" }],
    ["clearArrival", () => bridge.clearArrival("P"), "clear_arrival", { prId: "P" }],
    ["endReview", () => bridge.endReview(), "end_review", {}],
    ["openUrl", () => bridge.openUrl("https://x.dev"), "open_url", { url: "https://x.dev" }],
    ["openSettings", () => bridge.openSettings(), "open_settings", {}],
    ["openSetup", () => bridge.openSetup(), "open_setup", {}],
    ["openPanel", () => bridge.openPanel(), "open_panel", {}],
    ["reportProblem", () => bridge.reportProblem(), "report_problem", {}],
    [
      "openReview",
      () => bridge.openReview(pr),
      "open_review",
      {
        from: undefined,
        id: "PR_1",
        repo: "acme/web",
        number: 7,
        teams: [],
        queue: null,
        title: "#7 · Fix the cart · Ana",
      },
    ],
    [
      "openReview from a card",
      () => bridge.openReview(pr, ["core"], new DOMRect(1, 2, 3, 4), "review"),
      "open_review",
      {
        from: { x: 1, y: 2, width: 3, height: 4 },
        id: "PR_1",
        repo: "acme/web",
        number: 7,
        teams: ["core"],
        queue: "review",
        title: "#7 · Fix the cart · Ana",
      },
    ],
    [
      "switchReview",
      () => bridge.switchReview({ ...pr, author: { login: "ana", name: " " } }, [], "review"),
      "switch_review",
      { id: "PR_1", repo: "acme/web", number: 7, teams: [], queue: "review", title: "#7 · Fix the cart · ana" },
    ],
    [
      "switchReview, by a deleted account",
      () => bridge.switchReview({ ...pr, author: null }, [], null),
      "switch_review",
      { id: "PR_1", repo: "acme/web", number: 7, teams: [], queue: null, title: "#7 · Fix the cart · " },
    ],
    ["checkUpdate", () => bridge.checkUpdate(), "check_update", {}],
    ["updateOffered", () => bridge.updateOffered(), "update_offered", {}],
    ["installUpdate", () => bridge.installUpdate(), "install_update", {}],
    ["hidePanel", () => bridge.hidePanel(), "hide_panel", {}],
    ["confirm", () => bridge.confirm("T", "M", "OK"), "confirm", { title: "T", message: "M", ok: "OK" }],
    ["menuState", () => bridge.menuState({ approve: true }), "menu_state", { items: { approve: true } }],
    ["quit", () => bridge.quit(), "quit", {}],
  ];

  it.each(cases)("%s asks Rust", async (_name, call, cmd, args) => {
    const calls = rust();
    await call();
    expect(calls).toEqual([{ cmd, args }]);
  });

  it("uploads a file's bytes as they are", async () => {
    const calls = rust(() => ({ href: "https://github.com/a.png", kind: "image" }));
    const file = new File([new Uint8Array([1, 2, 3])], "shot one.png");
    expect(await bridge.uploadAttachment("acme/web", 7, file)).toEqual({
      href: "https://github.com/a.png",
      kind: "image",
    });
    expect(calls).toEqual([{ cmd: "upload_attachment", args: new Uint8Array([1, 2, 3]) }]);
  });

  it("hands a Rust event's payload to the handler", async () => {
    rust();
    const handler = vi.fn<(payload: string) => void>();
    const off = bridge.on<string>("snapshot", handler);
    await emit("snapshot", "fresh");
    expect(handler).toHaveBeenCalledWith("fresh");
    off();
    await Promise.resolve();
    await emit("snapshot", "later");
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("github", () => {
  it("sends the call through Rust and reads the JSON back", async () => {
    const calls = rust(replying(200, '{"login":"ana"}'));
    expect(await github("PATCH", "/user", { name: "Ana" })).toEqual({ login: "ana" });
    expect(calls).toEqual([
      { cmd: "github", args: { method: "PATCH", path: "/user", body: '{"name":"Ana"}', accept: null } },
    ]);
  });

  it("takes the text as it is when asked for another type, or when it isn't JSON", async () => {
    const calls = rust(replying(200, "# Title"));
    expect(await github("GET", "/readme", undefined, "application/vnd.github.raw")).toBe("# Title");
    expect(calls[0]?.args).toEqual({
      method: "GET",
      path: "/readme",
      body: null,
      accept: "application/vnd.github.raw",
    });
    expect(await github("GET", "/plain")).toBe("# Title");
  });

  it("takes an empty answer as it is", async () => {
    rust(replying(204, ""));
    expect(await github("DELETE", "/x")).toBe("");
  });

  it("throws GitHub's message for an error, or the status when it has none", async () => {
    rust(replying(422, '{"message":"Validation Failed"}'));
    await expect(github("POST", "/x")).rejects.toEqual(new GitHubError(422, "Validation Failed"));
    rust(replying(502, "<html>Bad gateway</html>"));
    const error = await github("GET", "/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ status: 502, message: "GitHub returned 502" });
  });
});

describe("graphql", () => {
  it("gives the data back, partial or not", async () => {
    const calls = rust(replying(200, '{"data":{"viewer":{"login":"ana"}},"errors":[{"message":"one field failed"}]}'));
    expect(await graphql("query { viewer { login } }")).toEqual({ viewer: { login: "ana" } });
    expect(calls[0]?.args).toMatchObject({
      method: "POST",
      path: "/graphql",
      body: '{"query":"query { viewer { login } }","variables":{}}',
    });
  });

  it("throws the first error when there's no data, or says there was none", async () => {
    rust(replying(200, '{"errors":[{"message":"Could not resolve"}]}'));
    await expect(graphql("query { x }", { id: 1 })).rejects.toThrow("Could not resolve");
    rust(replying(200, "{}"));
    await expect(graphql("query { x }")).rejects.toBeInstanceOf(GitHubError);
  });
});
