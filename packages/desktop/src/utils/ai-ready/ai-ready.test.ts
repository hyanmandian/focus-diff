import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AiStatus } from "@/utils/bridge/bridge";
import { defaultConfig, type AiProvider, type Config } from "@/utils/config/config";
import { EMIT_TO, mockCommands } from "@/utils/fake-platform/fake-platform";

const claude: AiStatus = {
  provider: "claude",
  installed: true,
  signed_in: true,
  version: "2.0",
  login_command: "claude /login",
};

/** Settings with `provider` chosen. */
const using = (provider: AiProvider | null): Config => {
  const config = defaultConfig();
  return { ...config, ai: { ...config.ai, provider } };
};

type Props = { config: Config | null };
const nothing: Props = { config: null };
const chosen: Props = { config: using("claude") };

/** The module afresh, nothing asked of the CLIs yet. */
function fresh() {
  vi.resetModules();
  return import("@/utils/ai-ready/ai-ready");
}

/** Rust answering what the CLIs say with `statuses` (counting the looks), and the alert with
 *  `ok`; every command asked lands in the list. */
function mac(statuses: () => unknown, ok = false) {
  const commands: string[] = [];
  mockCommands((cmd) => {
    commands.push(cmd);
    if (cmd === "ai_statuses") return statuses();
    if (cmd === "confirm") return ok;
    // Settings isn't open to be told which pane.
    if (cmd === EMIT_TO) return Promise.reject(new Error("no window"));
    return null;
  });
  return commands;
}

/** A promise to settle later, from the test. */
function later<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

const looks = (commands: string[]) => commands.filter((c) => c === "ai_statuses").length;

describe("aiProblem", () => {
  it("is nothing when the chosen AI is installed and signed in", async () => {
    mac(() => [claude]);
    const { aiProblem } = await fresh();
    expect(await aiProblem(using("claude"))).toBeNull();
  });

  it("says the AI is off when none is chosen", async () => {
    mac(() => []);
    const { aiProblem } = await fresh();
    expect(await aiProblem(using(null))).toMatchObject({ title: "AI is off" });
  });

  it("says the chosen one isn't installed, or isn't signed in, and how to sign in", async () => {
    mac(() => [claude, { ...claude, provider: "cursor", signed_in: false, login_command: "cursor-agent login" }]);
    const { aiProblem } = await fresh();
    expect(await aiProblem(using("cursor"))).toEqual({
      title: "Cursor isn't signed in",
      message: "Sign in once by running cursor-agent login in Terminal, then try again.",
    });
    mac(() => [{ ...claude, installed: false }]);
    const again = await fresh();
    expect(await again.aiProblem(using("claude"))).toMatchObject({ title: "Claude Code isn't installed" });
  });

  it("takes a failed look as not installed, and looks again next time", async () => {
    const commands = mac(() => Promise.reject(new Error("no shell")));
    const { aiProblem } = await fresh();
    expect(await aiProblem(using("claude"))).toMatchObject({ title: "Claude Code isn't installed" });
    await aiProblem(using("claude"));
    expect(looks(commands)).toBe(2);
  });

  it("keeps an answer a minute", async () => {
    const commands = mac(() => [claude]);
    const { aiProblem } = await fresh();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await aiProblem(using("claude"));
    clock.mockReturnValue(now + 59_000);
    await aiProblem(using("claude"));
    expect(looks(commands)).toBe(1);
    clock.mockReturnValue(now + 61_000);
    await aiProblem(using("claude"));
    expect(looks(commands)).toBe(2);
  });
});

describe("ensureAi", () => {
  it("is true when the AI can answer", async () => {
    const commands = mac(() => [claude]);
    const { ensureAi } = await fresh();
    expect(await ensureAi(using("claude"))).toBe(true);
    expect(commands).not.toContain("confirm");
  });

  it("says what's missing, and leaves Settings closed when told no", async () => {
    const commands = mac(() => [], false);
    const { ensureAi } = await fresh();
    expect(await ensureAi(using("claude"))).toBe(false);
    expect(commands).toContain("confirm");
    expect(commands).not.toContain("open_settings");
  });

  it("opens Settings on its AI pane when told to, and looks again after", async () => {
    const commands = mac(() => [], true);
    const { ensureAi } = await fresh();
    expect(await ensureAi(using("claude"))).toBe(false);
    expect(commands).toContain("open_settings");
    expect(localStorage.getItem("settings-pane")).toBe("ai");
    await ensureAi(using("claude"));
    expect(looks(commands)).toBe(2);
  });
});

describe("openAiSettings", () => {
  it("still opens Settings when the pane can't be remembered", async () => {
    const commands = mac(() => []);
    const { openAiSettings } = await fresh();
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    await openAiSettings();
    blocked.mockRestore();
    expect(commands).toContain("open_settings");
  });
});

describe("useAiProblem", () => {
  it("is nothing without settings or a chosen AI", async () => {
    mac(() => []);
    const { useAiProblem } = await fresh();
    const { result, rerender } = renderHook(({ config }) => useAiProblem(config), {
      initialProps: nothing,
    });
    expect(result.current).toBeNull();
    rerender({ config: using(null) });
    expect(result.current).toBeNull();
  });

  it("says what's missing, and looks again when the window comes forward", async () => {
    let installed = false;
    const commands = mac(() => [{ ...claude, installed }]);
    const { useAiProblem, openAiSettings } = await fresh();
    const { result } = renderHook(({ config }) => useAiProblem(config), { initialProps: chosen });
    await waitFor(() => {
      expect(result.current).toMatchObject({ title: "Claude Code isn't installed" });
    });
    installed = true;
    // Back from Settings: the cached answer is dropped.
    await openAiSettings();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    expect(looks(commands)).toBe(2);
  });

  it("drops an answer that comes after it's gone", async () => {
    const answer = later<AiStatus[]>();
    mac(() => answer.promise);
    const { useAiProblem } = await fresh();
    const { result, unmount } = renderHook(() => useAiProblem(using("claude")));
    unmount();
    answer.settle([]);
    await act(() => answer.promise);
    expect(result.current).toBeNull();
  });
});
