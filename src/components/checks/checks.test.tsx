import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Checks } from "@/components/checks/checks";
import type { Pull } from "@/hooks/use-pull/use-pull";
import type { CheckItem } from "@/utils/checks/checks";
import { fakeCheck, fakeChecks, fakeManage, fakePull } from "@/utils/mock-pull/mock-pull";
import { later } from "@/utils/mock-render/mock-render";

const pr = { owner: "acme", repo: "shop", number: 42, state: "OPEN" };

/** A command's named argument, as the page sent it. */
const arg = (args: InvokeArgs | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

type Answers = {
  /** GraphQL's node for a check run's detail, or a failure. */
  detail?: unknown;
  /** The job's log, or what Rust says instead. */
  log?: { text: string; truncated: boolean } | string | Error;
  /** Re-running a job: GitHub's status. */
  rerun?: number;
};

/** Answers what opening a check asks, recording the calls. */
function answer({ detail = null, log = { text: "", truncated: false }, rerun = 201 }: Answers = {}) {
  const calls: string[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "job_log") {
      calls.push(`log ${String(arg(args, "job"))} ${String(arg(args, "done"))}`);
      // oxlint-disable-next-line typescript/only-throw-error -- Rust's errors reach the page as strings.
      if (typeof log === "string" || log instanceof Error) throw log;
      return log;
    }
    if (cmd === "open_url") {
      calls.push(`open ${String(arg(args, "url"))}`);
      return null;
    }
    const path = String(arg(args, "path"));
    calls.push(`${String(arg(args, "method"))} ${path}`);
    if (path === "/graphql") {
      if (detail instanceof Error) throw detail;
      return { status: 200, body: JSON.stringify({ data: { node: detail } }) };
    }
    return { status: rerun, body: rerun < 400 ? "{}" : JSON.stringify({ message: "Not allowed" }) };
  });
  return calls;
}

const failing = fakeCheck({
  id: "CR_1",
  name: "test",
  state: "failure",
  detail: "failure",
  required: true,
  run: 7,
  job: 70,
});
const running = fakeCheck({
  id: "CR_2",
  name: "lint",
  state: "pending",
  detail: "in_progress",
  completedAt: null,
  run: 8,
  job: 80,
});
const skipped = fakeCheck({
  id: "CR_3",
  name: "deploy",
  state: "neutral",
  detail: "skipped",
  startedAt: null,
  workflow: null,
});
const passed = fakeCheck({ id: "CR_4", name: "build", completedAt: "2026-10-20T10:00:42Z" });
const status = fakeCheck({
  id: "ci/legacy",
  kind: "status",
  name: "ci/legacy",
  workflow: null,
  url: "http://ci",
  job: null,
  run: null,
});

type Setup = { checks?: CheckItem[]; pull?: Partial<Pull>; state?: string };

function checks({ checks: list = [failing, running, skipped, passed], pull: p = {}, state = "OPEN" }: Setup = {}) {
  const pull = fakePull({ checks: fakeChecks({ checks: list }), ...p });
  const hasFile = (path: string) => path.startsWith("src/");
  const onJump = vi.fn<(path: string, line: number | null) => void>();
  const say = vi.fn<(message: string) => void>();
  const result = render(<Checks pr={{ ...pr, state }} pull={pull} hasFile={hasFile} onJump={onJump} say={say} />);
  return { pull, onJump, say, ...result };
}

const row = (name: RegExp) => screen.getByRole("button", { name });

describe("Checks", () => {
  it("shows nothing without checks or runs waiting", () => {
    const { container } = checks({ checks: [] });
    expect(container.textContent).toBe("");
  });

  it("sums them up and groups them, open while something fails or runs", () => {
    checks({ pull: { checks: fakeChecks({ checks: [failing, running, skipped, passed], running: true }) } });
    const section = screen.getByRole("region", { name: "Checks" });
    expect(section.textContent).toContain("1 failing, 1 running, 1 skipped, and 1 passed");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Failing 1",
      "In progress 1",
      "Skipped or cancelled 1",
      "Successful 1",
    ]);
    expect(row(/test/u).textContent).toBe("CI / testRequired2m 5s");
    expect(row(/lint/u).textContent).toBe("CI / lintRunning");
    expect(row(/deploy/u).textContent).toBe("deploySkipped");
    expect(row(/build/u).textContent).toBe("CI / build42s");
    expect(within(row(/lint/u)).getByLabelText("Running")).toBeTruthy();
    expect(within(section).getAllByLabelText("Running")).toHaveLength(2);
  });

  it("starts closed when everything passed, and opens", async () => {
    checks({ checks: [passed, fakeCheck({ id: "x", name: "x", detail: "weird", completedAt: null })] });
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Checks/u }));
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Successful 2");
    expect(row(/x$/u).textContent).toBe("CI / x");
  });

  it("says nothing more of a check whose word it doesn't know", () => {
    checks({ checks: [fakeCheck({ state: "failure", detail: "odd", completedAt: null })] });
    expect(row(/build/u).textContent).toBe("CI / build");
  });

  it("re-runs failed jobs or all of them, for who can", async () => {
    const { pull } = checks();
    await userEvent.click(screen.getByRole("button", { name: "Re-run" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Re-run Failed Jobs" }));
    await userEvent.click(screen.getByRole("button", { name: "Re-run" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Re-run All Jobs" }));
    expect(vi.mocked(pull.actions.rerun).mock.calls).toEqual([["failed"], ["all"]]);
  });

  it("can't re-run failed jobs when none failed, or while re-running", async () => {
    checks({ checks: [passed], pull: { busy: "rerun" } });
    expect(screen.getByRole("button", { name: "Re-run" }).hasAttribute("disabled")).toBe(true);
    checks({ checks: [passed] });
    await userEvent.click(screen.getAllByRole("button", { name: "Re-run" })[1]!);
    expect((await screen.findByRole("menuitem", { name: "Re-run Failed Jobs" })).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("offers no re-running without write access or GitHub Actions runs", () => {
    checks({ pull: { manage: fakeManage({ viewerPermission: "READ" }) } });
    checks({ checks: [status] });
    expect(screen.queryByRole("button", { name: "Re-run" })).toBeNull();
  });

  it("approves fork runs waiting to run", async () => {
    const { pull } = checks({ pull: { awaiting: [{ id: 1, name: "CI" }] } });
    expect(screen.getByText("1 workflow from a fork is waiting for approval to run.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Approve and Run" }));
    expect(pull.actions.approve).toHaveBeenCalled();
  });

  it("shows waiting runs only to who can approve them, on an open pull request", () => {
    checks({ checks: [], pull: { awaiting: [{ id: 1, name: "CI" }], busy: "approve" } });
    expect(screen.getByRole("button", { name: "Approve and Run" }).hasAttribute("disabled")).toBe(true);
    checks({ checks: [], pull: { awaiting: [{ id: 1, name: "CI" }], manage: null } });
    checks({ checks: [], pull: { awaiting: [{ id: 1, name: "CI" }] }, state: "CLOSED" });
    expect(screen.getAllByRole("button", { name: "Approve and Run" })).toHaveLength(1);
  });

  describe("opened", () => {
    const detail = {
      summary: "  Two tests failed  ",
      text: null,
      annotations: {
        nodes: [
          {
            path: "src/cart.ts",
            annotationLevel: "FAILURE",
            title: "Wrong total",
            message: "Expected 2",
            location: { start: { line: 12 } },
          },
          { path: "src/cart.ts", annotationLevel: "WARNING", title: null, message: "Slow", location: null },
          {
            path: "vendor/x.js",
            annotationLevel: "NOTICE",
            title: null,
            message: "FYI",
            location: { start: { line: 3 } },
          },
        ],
      },
      steps: {
        nodes: [
          { number: 1, name: "Set up", status: "COMPLETED", conclusion: "SUCCESS" },
          { number: 2, name: "Run tests", status: "COMPLETED", conclusion: "FAILURE" },
        ],
      },
    };

    it("shows what a check says of itself: failed steps, annotations, summary", async () => {
      answer({ detail });
      const { onJump } = checks({ checks: [{ ...failing, description: "2 failed" }] });
      await userEvent.click(row(/test/u));
      expect(row(/test/u).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("2 failed")).toBeTruthy();
      expect(await screen.findByRole("list", { name: "Failed steps" })).toHaveProperty("textContent", "Run tests");
      const annotations = within(screen.getByRole("list", { name: "Annotations" })).getAllByRole("listitem");
      expect(annotations.map((a) => a.textContent)).toEqual([
        "src/cart.ts:12 Go to LineWrong totalExpected 2",
        "src/cart.ts Go to FileSlow",
        "vendor/x.js:3FYI",
      ]);
      expect(screen.getByText("Two tests failed")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Show src/cart.ts line 12 in the diff" }));
      await userEvent.click(screen.getByRole("button", { name: "Show src/cart.ts in the diff" }));
      expect(onJump.mock.calls).toEqual([
        ["src/cart.ts", 12],
        ["src/cart.ts", null],
      ]);
      await userEvent.click(row(/test/u));
      expect(screen.queryByRole("list", { name: "Annotations" })).toBeNull();
    });

    it("shows only the list's words when the detail can't be had, or has nothing", async () => {
      answer({ detail: new Error("offline") });
      checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      expect(screen.getByRole("button", { name: "Show Log" })).toBeTruthy();
      expect(screen.queryByRole("list")).not.toBeNull();
      expect(screen.queryByRole("list", { name: "Annotations" })).toBeNull();
    });

    it("drops a detail that arrives after it's closed", async () => {
      const held = later();
      mockIPC(() => held.promise.then(() => ({ status: 200, body: JSON.stringify({ data: { node: detail } }) })));
      checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(row(/test/u));
      held.settle();
      await held.promise;
      expect(screen.queryByRole("list", { name: "Failed steps" })).toBeNull();
    });

    it("asks a commit status for nothing, and opens only https links", async () => {
      const calls = answer();
      checks({ checks: [status, { ...passed, url: "https://github.com/acme/shop/runs/4" }] });
      await userEvent.click(screen.getByRole("button", { name: /Checks/u }));
      await userEvent.click(row(/legacy/u));
      expect(screen.queryByRole("button", { name: "Open on GitHub" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show Log" })).toBeNull();
      await userEvent.click(row(/build/u));
      await userEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
      expect(calls.filter((c) => !c.startsWith("POST"))).toEqual(["open https://github.com/acme/shop/runs/4"]);
    });

    it("shows the job's log, at its first error", async () => {
      const calls = answer({
        log: {
          text: "2026-10-20T10:00:00.000Z ##[group]Run tests\n[command]npm test\nok\n##[warning]slow\n##[error]boom\n",
          truncated: true,
        },
      });
      checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(screen.getByRole("button", { name: "Show Log" }));
      const log = await screen.findByRole("log", { name: "Job log" });
      expect([...log.children].map((l) => `${l.getAttribute("data-kind")}:${l.textContent}`)).toEqual([
        "group:Run tests",
        "command:npm test",
        "plain:ok",
        "warning:slow",
        "error:boom",
      ]);
      expect(screen.getByText("Only the end of a long log is shown.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Show Log" })).toBeNull();
      expect(calls).toContain("log 70 true");
    });

    it("scrolls a log without errors to its end, and keeps empty lines' height", async () => {
      answer({ log: { text: "one\n\ntwo", truncated: false } });
      checks({ checks: [passed] });
      await userEvent.click(screen.getByRole("button", { name: /Checks/u }));
      await userEvent.click(row(/build/u));
      await userEvent.click(screen.getByRole("button", { name: "Show Log" }));
      const log = await screen.findByRole("log");
      expect([...log.children].map((l) => l.textContent)).toEqual(["one", " ", "two"]);
      expect(log.scrollTop).toBe(log.scrollHeight);
    });

    it("says why the log couldn't be had, and lets it be asked again", async () => {
      answer({ log: "Log expired" });
      checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(screen.getByRole("button", { name: "Show Log" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Log expired");
      answer({ log: new Error("Offline") });
      await userEvent.click(screen.getByRole("button", { name: "Show Log" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Offline");
    });

    it("waits for a running job to finish before its log, and can't re-run it", async () => {
      answer();
      checks({ checks: [running] });
      await userEvent.click(row(/lint/u));
      expect(screen.getByRole("button", { name: "Log When It Finishes" }).hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("button", { name: "Re-run Job" })).toBeNull();
    });

    it("re-runs one job, and says how it went", async () => {
      const calls = answer();
      const { say } = checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(screen.getByRole("button", { name: "Re-run Job" }));
      await waitFor(() => {
        expect(say).toHaveBeenCalledWith("Re-running");
      });
      expect(calls).toContain("POST /repos/acme/shop/actions/jobs/70/rerun");
    });

    it("says why GitHub wouldn't re-run a job", async () => {
      answer({ rerun: 403 });
      const { say } = checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(screen.getByRole("button", { name: "Re-run Job" }));
      await waitFor(() => {
        expect(say).toHaveBeenCalledWith("Not allowed");
      });
    });

    it("says what Rust said when the call itself failed", async () => {
      mockIPC(() => {
        // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Rust's errors reach the page as strings.
        throw "No network";
      });
      const { say } = checks({ checks: [failing] });
      await userEvent.click(row(/test/u));
      await userEvent.click(screen.getByRole("button", { name: "Re-run Job" }));
      await waitFor(() => {
        expect(say).toHaveBeenCalledWith("No network");
      });
    });

    it("doesn't offer re-running a job to who can't", async () => {
      answer();
      checks({ checks: [failing], pull: { manage: fakeManage({ viewerPermission: "TRIAGE" }) } });
      await userEvent.click(row(/test/u));
      expect(screen.queryByRole("button", { name: "Re-run Job" })).toBeNull();
    });
  });
});
