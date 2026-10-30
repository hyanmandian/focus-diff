import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AskAi } from "@/components/ask-ai/ask-ai";
import type { AiAnswer } from "@/utils/bridge/bridge";
import { defaultConfig, type Config } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { fakeDetails } from "@/utils/mock-pull/mock-pull";

const ai = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<boolean>>(),
  problem: vi.fn<() => { title: string; message: string } | null>(),
  openSettings: vi.fn<() => Promise<void>>(),
  ask: vi.fn<(config: unknown, details: unknown, prompt: string, run: string) => Promise<AiAnswer>>(),
}));
vi.mock("@/utils/ai-ready/ai-ready", () => ({
  ensureAi: ai.ready,
  useAiProblem: ai.problem,
  openAiSettings: ai.openSettings,
}));
vi.mock("@/utils/ai/ai", async (original) => ({ ...(await original<object>()), ask: ai.ask }));

const DETAILS = fakeDetails();

function config(over: Partial<Config["ai"]> = {}): Config {
  const c = defaultConfig();
  return {
    ...c,
    ai: {
      ...c.ai,
      provider: "claude",
      prompts: [{ id: "p1", name: "Explain", prompt: "Explain this change." }],
      ...over,
    },
  };
}

const NOTHING = () => {};

function deferred<T = void>() {
  let resolve: (value: T) => void = NOTHING;
  let reject: (e: unknown) => void = NOTHING;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const field = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Ask Claude Code about this pull request" });
const send = () => screen.getByRole<HTMLButtonElement>("button", { name: "Ask" });

function cancels() {
  const runs: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "ai_cancel") runs.push(args);
  });
  return runs;
}

beforeEach(() => {
  ai.ready.mockResolvedValue(true);
  ai.problem.mockReturnValue(null);
  ai.openSettings.mockResolvedValue();
  ai.ask.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AskAi", () => {
  it("isn't shown without an AI chosen", () => {
    const { container } = render(<AskAi config={config({ provider: null })} details={DETAILS} />);
    expect(container.textContent).toBe("");
  });

  it("asks a saved prompt and shows the answer, with its note", async () => {
    ai.ask.mockResolvedValue({ text: "It **renames** the queue.", project: false, note: "Read the diff only." });
    render(<AskAi config={config()} details={DETAILS} />);
    expect(screen.getByRole("heading", { name: "Ask Claude Code" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText("renames")).toHaveProperty("tagName", "STRONG");
    expect(screen.getByText("Read the diff only.")).toBeTruthy();
    expect(ai.ask).toHaveBeenCalledWith(expect.anything(), DETAILS, "Explain this change.", expect.any(String));
    expect(screen.getAllByText("Explain").map((e) => e.tagName)).toEqual(["BUTTON", "P"]);
  });

  it("sends a question of one's own, then clears the field", async () => {
    ai.ask.mockResolvedValue({ text: "Yes.", project: true });
    render(<AskAi config={config({ prompts: [] })} details={DETAILS} />);
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
    expect(send().disabled).toBe(true);
    await userEvent.type(field(), "  Is it safe?  {Enter}");
    expect(await screen.findByText("Yes.")).toBeTruthy();
    expect(ai.ask).toHaveBeenCalledWith(expect.anything(), DETAILS, "Is it safe?", expect.any(String));
    expect(field().value).toBe("");
  });

  it("keeps the question when the AI isn't ready to take it", async () => {
    ai.ready.mockResolvedValue(false);
    render(<AskAi config={config()} details={DETAILS} />);
    await userEvent.type(field(), "Is it safe?{Enter}");
    await waitFor(() => {
      expect(ai.ready).toHaveBeenCalled();
    });
    expect(field().value).toBe("Is it safe?");
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(ai.ask).not.toHaveBeenCalled();
  });

  it("ignores an empty question", async () => {
    render(<AskAi config={config()} details={DETAILS} />);
    await userEvent.type(field(), "   {Enter}");
    expect(ai.ready).not.toHaveBeenCalled();
  });

  it("says it's reading while it waits, how long after a few seconds, and can be stopped", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answer = deferred<AiAnswer>();
    ai.ask.mockReturnValue(answer.promise);
    const cancelled = cancels();
    render(<AskAi config={config({ project: false })} details={DETAILS} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    const reading = await screen.findByText(/Reading the diff/u);
    expect(screen.getByRole("region").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Explain" }).disabled).toBe(true);
    await userEvent.type(field(), "And this?{Enter}");
    fireEvent.submit(field());
    expect(ai.ask).toHaveBeenCalledOnce();
    expect(reading.textContent).not.toContain("·");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(reading.textContent).toContain(" · 4s");
    expect(screen.getByText(/· 4s/u).closest("[aria-hidden]")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    const run = ai.ask.mock.calls[0]?.[3];
    expect(cancelled).toEqual([{ run }]);
    answer.reject(new Error("Stopped."));
    expect((await screen.findByRole("alert")).textContent).toBe("Stopped.");
  });

  it("says it's reading the project when it reads it", async () => {
    ai.ask.mockReturnValue(new Promise(() => {}));
    render(<AskAi config={config({ project: true })} details={DETAILS} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText(/Reading the project/u)).toBeTruthy();
  });

  it("shows what went wrong, in words whatever was thrown", async () => {
    ai.ask.mockRejectedValueOnce("The CLI quit.").mockRejectedValueOnce({ code: 7 });
    render(<AskAi config={config()} details={DETAILS} />);
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The CLI quit.");
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("[object Object]");
    });
  });

  it("says when the AI isn't set up, with the way to Settings", async () => {
    ai.problem.mockReturnValue({ title: "Claude Code isn't installed", message: "Install it." });
    render(<AskAi config={config()} details={DETAILS} />);
    expect(screen.getByText(/Claude Code isn't set up yet\./u)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open AI Settings" }));
    expect(ai.openSettings).toHaveBeenCalledOnce();
  });
});
