import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Ai } from "@/components/settings-ai/settings-ai";
import type { AiStatus } from "@/utils/bridge/bridge";
import { defaultConfig, REVIEW_PROMPT, type AiProvider, type Config } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";

afterEach(() => {
  setLanguage("en");
});

const status = (provider: AiProvider, patch: Partial<AiStatus> = {}): AiStatus => ({
  provider,
  installed: true,
  signed_in: true,
  version: "1.0",
  login_command: `${provider} login`,
  ...patch,
});

function field(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null ? Reflect.get(args, key) : undefined;
}

const suggested = () => [...document.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));

type Rust = {
  statuses?: AiStatus[];
  models?: Partial<Record<string, string[]>>;
  confirm?: boolean;
};

function setup(ai: Partial<Config["ai"]> = {}, rust: Rust = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  let answer: ((statuses: AiStatus[]) => void) | undefined;
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "ai_statuses")
      return (
        rust.statuses ??
        new Promise<AiStatus[]>((resolve) => {
          answer = resolve;
        })
      );
    if (cmd === "ai_models") {
      const provider = field(args, "provider");
      const models = typeof provider === "string" ? rust.models?.[provider] : undefined;
      if (!models) throw new Error("no models");
      return models;
    }
    if (cmd === "confirm") return rust.confirm ?? true;
    return null;
  });
  const changes = vi.fn<(c: Config) => void>();
  const initial = defaultConfig();
  function Harness() {
    const [config, setConfig] = useState<Config>({ ...initial, ai: { ...initial.ai, ...ai } });
    return (
      <Ai
        config={config}
        onChange={(c) => {
          changes(c);
          setConfig(c);
        }}
      />
    );
  }
  render(<Harness />, { wrapper: StrictMode });
  const last = () => changes.mock.lastCall![0].ai;
  const asked = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  return {
    user: userEvent.setup(),
    changes,
    last,
    asked,
    answer: (statuses: AiStatus[]) => {
      act(() => {
        answer?.(statuses);
      });
    },
  };
}

const row = (name: string) => screen.getByRole("radio", { name }).parentElement!;

describe("Ai", () => {
  it("says it's checking until it knows what's installed", async () => {
    const { answer } = setup();
    expect(screen.getByRole("radio", { name: "No AI" }).getAttribute("aria-checked")).toBe("true");
    expect(row("Claude Code").textContent).toContain("Checking…");
    expect(row("No AI").textContent).toContain("Everything works without it.");
    expect(screen.getByRole("button", { name: /Check Again/u })).toHaveProperty("disabled", true);
    answer([status("claude", { version: "2.1" })]);
    await waitFor(() => {
      expect(row("Claude Code").textContent).toContain("Ready · 2.1");
    });
    expect(row("Cursor").textContent).toContain("Not installed on this computer.");
    expect(screen.getByRole("button", { name: /Check Again/u })).toHaveProperty("disabled", false);
  });

  it("links to a CLI that isn't installed, and shows how to sign in to one that is", async () => {
    const { user, asked } = setup(
      {},
      {
        statuses: [status("claude", { installed: false }), status("cursor", { signed_in: false, version: null })],
      },
    );
    await user.click(await within(row("Claude Code")).findByRole("button", { name: /Get it/u }));
    expect(asked("open_url").map((c) => field(c.args, "url"))).toEqual(["https://claude.com/product/claude-code"]);

    expect(row("Cursor").textContent).toContain("Installed, not signed in.");
    await user.click(within(row("Cursor")).getByRole("button", { name: "Copy cursor login" }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe("cursor login");
    });
  });

  it("shows the version as empty when the CLI doesn't say it", async () => {
    setup({}, { statuses: [status("claude", { version: null })] });
    await waitFor(() => {
      expect(row("Claude Code").textContent).toContain("Ready ·");
    });
  });

  it("checks again on request", async () => {
    const { user, asked } = setup({}, { statuses: [status("claude")] });
    const again = screen.getByRole("button", { name: /Check Again/u });
    await waitFor(() => {
      expect(again).toHaveProperty("disabled", false);
    });
    const before = asked("ai_statuses").length;
    await user.click(again);
    await waitFor(() => {
      expect(asked("ai_statuses")).toHaveLength(before + 1);
    });
  });

  it("picks a CLI, starting from its defaults, and goes back to none", async () => {
    const { user, last, changes } = setup({}, { statuses: [] });
    await user.click(screen.getByRole("radio", { name: "Claude Code" }));
    expect(last()).toMatchObject({ provider: "claude", model: "", effort: "" });
    expect(screen.getByRole("radio", { name: "Claude Code" }).getAttribute("aria-checked")).toBe("true");

    const before = changes.mock.calls.length;
    await user.click(screen.getByRole("radio", { name: "Claude Code" }));
    expect(changes.mock.calls).toHaveLength(before + 1);
    expect(last().provider).toBe("claude");

    await user.click(screen.getByRole("radio", { name: "No AI" }));
    expect(last().provider).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
  });

  it("suggests the chosen CLI's models, and only its own", async () => {
    const { user, asked } = setup(
      { provider: "claude" },
      { statuses: [], models: { claude: ["opus", "sonnet"], cursor: ["gpt"] } },
    );
    await waitFor(() => {
      expect(suggested()).toEqual(["opus", "sonnet"]);
    });
    await user.click(screen.getByRole("radio", { name: "Cursor" }));
    await waitFor(() => {
      expect(suggested()).toEqual(["gpt"]);
    });
    await user.click(screen.getByRole("radio", { name: "Claude Code" }));
    await waitFor(() => {
      expect(suggested()).toEqual(["opus", "sonnet"]);
    });
    expect(asked("ai_models").map((c) => field(c.args, "provider"))).toContain("cursor");
  });

  it("suggests no models when the CLI can't list them", async () => {
    const { asked } = setup({ provider: "claude" }, { statuses: [] });
    await waitFor(() => {
      expect(asked("ai_models").length).toBeGreaterThan(0);
    });
    expect(document.querySelectorAll("datalist option")).toHaveLength(0);
  });

  it("sets the model, effort and what it may read", async () => {
    const { user, last } = setup({ provider: "claude" }, { statuses: [], models: { claude: [] } });
    await user.type(screen.getByRole("combobox", { name: "Model" }), "opus");
    expect(last().model).toBe("opus");

    await user.click(screen.getByRole("combobox", { name: "Effort" }));
    await user.click(await screen.findByRole("option", { name: "High" }));
    expect(last().effort).toBe("high");
    expect(screen.getByRole("combobox", { name: "Effort" }).textContent).toContain("High");

    await user.click(screen.getByRole("switch", { name: /Read the whole project/u }));
    expect(last().project).toBe(false);
    await user.click(screen.getByRole("switch", { name: /AI review when a pull request opens/u }));
    expect(last().review.auto).toBe(true);

    await user.type(screen.getByRole("textbox", { name: "Your review guidelines" }), "Be kind");
    expect(last().instructions).toBe("Be kind");
  });

  it("says Cursor's effort is part of its model", () => {
    setup({ provider: "cursor" }, { statuses: [], models: { cursor: [] } });
    expect(screen.queryByRole("combobox", { name: "Effort" })).toBeNull();
    expect(screen.getByText(/Part of the model you pick/u)).toBeTruthy();
  });

  it("edits what the AI review looks for, and restores the default", async () => {
    const { user, last } = setup({ provider: "claude" }, { statuses: [], models: { claude: [] } });
    expect(screen.queryByRole("button", { name: "Restore Default" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "What the review looks for" }), "!");
    expect(last().review.prompt).toBe(`${REVIEW_PROMPT}!`);
    await user.click(screen.getByRole("button", { name: "Restore Default" }));
    expect(last().review.prompt).toBe(REVIEW_PROMPT);
  });

  it("renames, rewrites, moves and adds prompts, up to twelve", async () => {
    const { user, last } = setup({ provider: "claude" }, { statuses: [], models: { claude: [] } });
    const names = () => last().prompts.map((p) => p.name);

    await user.type(screen.getByRole("textbox", { name: "What Summary asks" }), "!");
    expect(last().prompts[0]!.prompt.endsWith("!")).toBe(true);
    const name = screen.getAllByRole("textbox", { name: "Button name" })[0]!;
    await user.clear(name);
    await user.type(name, "Gist");
    expect(names()[0]).toBe("Gist");

    expect(screen.getByRole("button", { name: "Move Gist up" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Move Gist down" }));
    expect(names().slice(0, 2)).toEqual(["Find problems", "Gist"]);
    await user.click(screen.getByRole("button", { name: "Move Gist up" }));
    expect(names()[0]).toBe("Gist");
    expect(screen.getByRole("button", { name: "Move Missing tests down" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Add Prompt" }));
    expect(last().prompts.at(-1)).toMatchObject({ name: "New prompt" });

    await user.click(screen.getByRole("button", { name: "Restore Defaults" }));
    expect(names()).toEqual(["Summary", "Find problems", "Explain", "Missing tests"]);
  });

  it("can't add more than twelve prompts", () => {
    const prompts = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, prompt: "" }));
    setup({ provider: "claude", prompts }, { statuses: [], models: { claude: [] } });
    expect(screen.getByRole("button", { name: "Add Prompt" })).toHaveProperty("disabled", true);
  });

  it("removes a prompt once confirmed", async () => {
    const { user, last, asked } = setup({ provider: "claude" }, { statuses: [], models: { claude: [] } });
    await user.click(screen.getByRole("button", { name: "Remove Find problems" }));
    await waitFor(() => {
      expect(last().prompts.map((p) => p.name)).toEqual(["Summary", "Explain", "Missing tests"]);
    });
    expect(asked("confirm").map((c) => field(c.args, "title"))).toEqual(["Remove the “Find problems” prompt?"]);
  });

  it("keeps a prompt when its removal isn't confirmed", async () => {
    const { user, changes, asked } = setup(
      { provider: "claude" },
      { statuses: [], models: { claude: [] }, confirm: false },
    );
    await user.click(screen.getByRole("button", { name: "Remove Find problems" }));
    await waitFor(() => {
      expect(asked("confirm")).toHaveLength(1);
    });
    expect(changes).not.toHaveBeenCalled();
  });

  it("rewords itself when the language changes", async () => {
    setup({ provider: "claude" }, { statuses: [status("claude"), status("cursor", { signed_in: false })] });
    await waitFor(() => {
      expect(row("Claude Code").textContent).toContain("Ready");
    });
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByRole("button", { name: /Checar de novo/u })).toBeTruthy();
    act(() => {
      setLanguage("en");
    });
    expect(screen.getByRole("button", { name: /Check Again/u })).toBeTruthy();
  });
});
