import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args: { message: string }) => Promise<void>>(async () => {}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { forwardErrors } from "@/utils/error-log/error-log";

const rejected = (reason: unknown) => {
  window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason }));
};

describe("forwardErrors", () => {
  const original = console.error;
  afterEach(() => {
    console.error = original;
    invoke.mockClear();
  });

  it("sends console errors, uncaught errors and unhandled rejections to the log", () => {
    console.error = vi.fn<typeof console.error>();
    forwardErrors();
    const failure = new Error("boom");
    failure.stack = "at here";
    console.error("Saving failed", failure, { title: "Fix the payroll bug" }, null, 3, true);
    window.dispatchEvent(new ErrorEvent("error", { message: "bad thing", filename: "panel.js", lineno: 3 }));
    window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed" }));
    const why = new Error("lost");
    why.stack = "at there";
    rejected(why);
    rejected("plain");
    const bare = new Error("bare");
    bare.stack = "";
    rejected(bare);

    expect(invoke.mock.calls.map(([, args]) => args)).toEqual([
      { message: "Saving failed Error: boom\nat here [object] [null] 3 true" },
      { message: "bad thing at panel.js:3" },
      { message: "Unhandled: Error: lost\nat there" },
      { message: "Unhandled: plain" },
      { message: "Unhandled: Error: bare" },
    ]);
  });

  it("never fails when the log can't be written", async () => {
    console.error = vi.fn<typeof console.error>();
    invoke.mockRejectedValueOnce(new Error("no app"));
    forwardErrors();
    console.error("x");
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
