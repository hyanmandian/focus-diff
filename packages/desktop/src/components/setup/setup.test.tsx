import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Setup } from "@/components/setup/setup";
import type { AiStatus, AuthStatus } from "@/utils/bridge/bridge";
import { defaultConfig, normalize, TEMPLATES, type Config } from "@/utils/config/config";
import { CLOSE_WINDOW, mockCommands } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";

const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("@/utils/os/os", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    get isMac() {
      return platform.mac;
    },
  };
});

afterEach(() => {
  platform.mac = false;
});

const signedIn: AuthStatus = {
  signed_in: true,
  source: "keychain",
  login: "octocat",
  device_flow: false,
  gh_available: true,
  gh_signed_in: true,
};
const signedOut: AuthStatus = { ...signedIn, signed_in: false, source: null, login: null };

const ready = (provider: AiStatus["provider"], version: string | null = "1.0.0"): AiStatus => ({
  provider,
  installed: true,
  signed_in: true,
  version,
  login_command: `${provider} login`,
  outdated: false,
  update_command: `${provider} update`,
});

function later<T>() {
  const settlers: Array<(value: T) => void> = [];
  const promise = new Promise<T>((resolve) => {
    settlers.push(resolve);
  });
  return {
    promise,
    settle: (value: T) => {
      for (const settle of settlers) settle(value);
    },
  };
}

type Answers = {
  auth?: () => Promise<AuthStatus>;
  config?: Config;
  read?: () => Promise<string>;
  statuses?: () => Promise<AiStatus[]>;
  write?: () => Promise<void>;
};

function answer({
  auth = () => Promise.resolve(signedIn),
  config = defaultConfig(),
  read = () => Promise.resolve(JSON.stringify(config)),
  statuses = () => Promise.resolve([]),
  write = () => Promise.resolve(),
}: Answers = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "auth_status":
        return auth();
      case "read_file":
        return read();
      case "write_file":
        return write();
      case "ai_statuses":
        return statuses();
      default:
        return null;
    }
  });
  const saved = () => {
    const last = calls.findLast((c) => c.cmd === "write_file")?.args;
    const contents = last && typeof last === "object" && "contents" in last ? String(last.contents) : "{}";
    return normalize(JSON.parse(contents));
  };
  const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  return { calls, saved, sent };
}

const next = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Continue" }));
};
const enter = (target: Element, key = "Enter") => {
  fireEvent.keyDown(target, { key });
};
const toAi = async (user: ReturnType<typeof userEvent.setup>) => {
  await next(user);
  await next(user);
  await next(user);
  await next(user);
};

async function aiStep() {
  const config = defaultConfig();
  config.ai = { ...config.ai, provider: "claude", model: "opus", effort: "high" };
  const { saved } = answer({ config, statuses: () => Promise.resolve([ready("claude"), ready("cursor")]) });
  const user = userEvent.setup();
  render(<Setup />);
  await screen.findByText("@octocat");
  await toAi(user);
  expect(screen.getAllByText("Ready · 1.0.0")).toHaveLength(2);
  const finish = async () => {
    await next(user);
    await user.click(screen.getByRole("button", { name: "Open Focus Diff" }));
  };
  return { user, saved, finish };
}

describe("Setup", () => {
  it("waits for the settings, then greets whoever is signed in", async () => {
    answer();
    render(<Setup />);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(await screen.findByText("@octocat")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your reviews, without opening GitHub" })).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toBe("GitHub");
  });

  it("asks to connect GitHub, lets it wait for later, and says who once it is", async () => {
    let auth = signedOut;
    answer({ auth: () => Promise.resolve(auth) });
    const user = userEvent.setup();
    render(<Setup />);
    const useGh = await screen.findByRole("button", { name: "Use the GitHub CLI's login" });
    expect(screen.getByRole("button", { name: "Sign in later" }).hasAttribute("disabled")).toBe(false);

    auth = signedIn;
    await user.click(useGh);
    expect(await screen.findByText("@octocat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
  });

  it("goes on without GitHub when it's left for later", async () => {
    const { sent } = answer({ auth: () => Promise.resolve(signedOut) });
    const user = userEvent.setup();
    render(<Setup />);
    await user.click(await screen.findByRole("button", { name: "Sign in later" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What should it watch?");
    for (const box of screen.getAllByRole("checkbox"))
      if (box.getAttribute("aria-checked") === "true") await user.click(box);
    enter(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What should it watch?");
    expect(sent("write_file")).toEqual([]);
  });

  it("still opens when it can't check GitHub, the settings or the AI tools", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer({
      auth: () => Promise.reject(new Error("gh hung")),
      read: () => Promise.reject(new Error("no disk")),
      statuses: () => Promise.reject(new Error("no ai")),
    });
    render(<Setup />);
    expect(await screen.findByLabelText("Personal access token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in later" })).toBeTruthy();
  });

  it("shows it's checking GitHub until it hears back", async () => {
    answer({ auth: () => later<AuthStatus>().promise });
    render(<Setup />);
    expect(await screen.findByLabelText("Checking GitHub")).toBeTruthy();
  });

  it("walks through every step and saves the choices when finished", async () => {
    const config = defaultConfig();
    config.queues = [
      ...config.queues.map((q) => ({ ...q, enabled: q.kind !== "authored" })),
      { ...TEMPLATES.custom.make(), name: "Mine" },
    ];
    const { saved, sent } = answer({
      config,
      statuses: () => Promise.resolve([ready("claude", null), { ...ready("cursor"), signed_in: false }]),
    });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await next(user);

    expect(screen.getByRole("heading", { name: "What should it watch?" })).toBeTruthy();
    const review = screen.getByRole("checkbox", { name: /Needs my review/u });
    const involved = screen.getByRole("checkbox", { name: /Updates/u });
    expect(review.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("checkbox", { name: /My pull requests/u }).getAttribute("aria-checked")).toBe("false");
    await user.click(review);
    await user.click(involved);
    expect(review.getAttribute("aria-checked")).toBe("false");
    await user.click(review);
    await user.click(screen.getByRole("checkbox", { name: /Merged without me/u }));

    const repos = screen.getByRole("textbox", { name: "Repositories" });
    await user.type(repos, "nope{Enter}");
    expect(screen.getByRole("alert").textContent).toContain("Use owner/name");
    await user.clear(repos);
    await user.type(repos, "acme/web{Enter}");
    await next(user);

    expect(screen.getByRole("heading", { name: "How do you like to go through a diff?" })).toBeTruthy();
    const stack = screen.getByRole("checkbox", { name: /Frontend and backend/u });
    const generated = screen.getByRole("checkbox", { name: /Without generated files/u });
    expect(stack.getAttribute("aria-checked")).toBe("true");
    expect(generated.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("checkbox", { name: /One area/u })).toBeNull();
    await user.click(generated);
    await user.click(screen.getByRole("checkbox", { name: /Code, then tests/u }));
    expect(generated.getAttribute("aria-checked")).toBe("false");
    await next(user);

    expect(screen.getByRole("heading", { name: "How should it tell you?" })).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Play a sound" }));
    await user.click(screen.getByRole("combobox", { name: "Check GitHub every" }));
    await user.click(await screen.findByRole("option", { name: "5 minutes" }));
    expect(screen.getByRole("combobox", { name: "Check GitHub every" }).textContent).toContain("5 minutes");
    await next(user);

    expect(screen.getByRole("radio", { name: /No AI/u }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("You can turn it on later.")).toBeTruthy();
    expect(screen.getByText("cursor login")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Get it/u })).toHaveLength(2);
    await user.click(screen.getByRole("radio", { name: /Claude Code/u }));
    expect(screen.getByRole("radio", { name: /Claude Code/u }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("You can turn it on later.")).toBeNull();
    await next(user);

    expect(screen.getByRole("heading", { name: "You're set" })).toBeTruthy();
    expect(screen.getByText(/the system tray/u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open Focus Diff" }));

    await waitFor(() => {
      expect(sent(CLOSE_WINDOW)).toHaveLength(1);
    });
    expect(sent("open_panel")).toHaveLength(1);
    const final = saved();
    expect(final.queues.map((q) => [q.kind, q.enabled, q.repos])).toEqual([
      ["review", true, ["acme/web"]],
      ["merged", true, ["acme/web"]],
      ["custom", true, []],
    ]);
    expect(final.queues[0]!.id).toBe(config.queues[0]!.id);
    expect(final).toMatchObject({ sound: true, pollSeconds: 300, ai: { provider: "claude" } });
    expect(final.filters.map((f) => f.name)).toEqual(["Frontend", "Backend", "Code", "Tests"]);
    expect(final.filters[0]!.id).toBe(config.filters[0]!.id);
  });

  it("says why it couldn't finish and lets you try again", async () => {
    const failures: unknown[] = [new Error("disk full"), "no room"];
    const { sent } = answer({
      write: () => (failures.length > 0 ? Promise.reject(failures.shift()) : Promise.resolve()),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await toAi(user);
    await next(user);
    const open = screen.getByRole("button", { name: "Open Focus Diff" });

    await user.click(open);
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't finish: disk full");
    expect(open.hasAttribute("disabled")).toBe(false);
    await user.click(open);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Couldn't finish: no room");
    });
    await user.click(open);

    await waitFor(() => {
      expect(sent(CLOSE_WINDOW)).toHaveLength(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers to report a problem from any step", async () => {
    const { sent } = answer({ auth: () => Promise.resolve(signedOut) });
    const user = userEvent.setup();
    render(<Setup />);
    await user.click(await screen.findByRole("button", { name: "Having trouble? Report a problem" }));
    expect(sent("report_problem")).toHaveLength(1);
  });

  it("keeps the model when the same agent is picked again", async () => {
    const { user, saved, finish } = await aiStep();
    await user.click(screen.getByRole("radio", { name: /Claude Code/u }));
    await finish();
    await waitFor(() => {
      expect(saved().ai).toMatchObject({ provider: "claude", model: "opus", effort: "high" });
    });
  });

  it("says when an agent works but is out of date", async () => {
    answer({ statuses: () => Promise.resolve([{ ...ready("claude"), outdated: true }]) });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await toAi(user);
    expect(screen.getByText("Works, but out of date: run claude update")).toBeTruthy();
  });

  it("starts the model over for another agent", async () => {
    const { user, saved, finish } = await aiStep();
    await user.click(screen.getByRole("radio", { name: /Cursor/u }));
    await user.click(screen.getByRole("radio", { name: /No AI/u }));
    expect(screen.getByRole("radio", { name: /No AI/u }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("radio", { name: /Cursor/u }));
    await finish();
    await waitFor(() => {
      expect(saved().ai).toMatchObject({ provider: "cursor", model: "", effort: "" });
    });
  });

  it("looks for coding agents, and links to the ones not installed", async () => {
    const found = later<AiStatus[]>();
    const { sent } = answer({ statuses: () => found.promise });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await toAi(user);

    expect(screen.getByLabelText("Looking for coding agents")).toBeTruthy();
    await act(async () => {
      found.settle([{ ...ready("claude"), installed: false }]);
      await Promise.resolve();
    });
    expect(screen.queryByLabelText("Looking for coding agents")).toBeNull();
    const getIt = screen.getAllByRole("button", { name: /Get it/u });
    expect(getIt).toHaveLength(4);
    await user.click(getIt[0]!);
    expect(sent("open_url")[0]?.args).toEqual({ url: "https://claude.com/product/claude-code" });
  });

  it("goes on with Return, unless a field or button has it, and finishes with it", async () => {
    const { sent } = answer();
    const user = userEvent.setup();
    platform.mac = true;
    render(<Setup />);
    await screen.findByText("@octocat");

    enter(screen.getByRole("heading", { level: 1 }), "Escape");
    enter(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your reviews, without opening GitHub");

    for (const title of [
      "What should it watch?",
      "How do you like to go through a diff?",
      "How should it tell you?",
      "Want a second pair of eyes?",
      "You're set",
    ]) {
      enter(screen.getByRole("heading", { level: 1 }));
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    }
    expect(screen.getByText(/lives in your menu bar\. Click/u)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Want a second pair of eyes?");
    enter(screen.getByRole("heading", { level: 1 }));
    enter(screen.getByRole("heading", { level: 1 }));
    await waitFor(() => {
      expect(sent(CLOSE_WINDOW)).toHaveLength(1);
    });
  });

  it("shows it's saving until it's done", async () => {
    const saving = later<undefined>();
    const { sent } = answer({ write: () => saving.promise });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await toAi(user);
    await next(user);
    const open = screen.getByRole("button", { name: "Open Focus Diff" });
    await user.click(open);
    expect(open.hasAttribute("disabled")).toBe(true);
    enter(screen.getByRole("heading", { level: 1 }));
    expect(sent("write_file")).toHaveLength(1);
    await act(async () => {
      saving.settle(undefined);
      await Promise.resolve();
    });
  });

  it("starts with no repositories when the queues don't share theirs", async () => {
    const config = defaultConfig();
    config.queues[0]!.repos = ["acme/web"];
    answer({ config });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await next(user);
    expect(screen.queryByText("acme/web")).toBeNull();
  });

  it("keeps each queue's own repositories when they differed and none were given", async () => {
    const config = defaultConfig();
    config.queues[0]!.repos = ["acme/web"];
    const { saved, sent } = answer({ config });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await toAi(user);
    await next(user);
    await user.click(screen.getByRole("button", { name: "Open Focus Diff" }));
    await waitFor(() => {
      expect(sent(CLOSE_WINDOW)).toHaveLength(1);
    });
    expect(saved().queues.map((q) => q.repos)).toEqual([["acme/web"], [], []]);
  });

  it("starts with the repositories every queue shares", async () => {
    const config = defaultConfig();
    config.queues = config.queues.map((q) => ({ ...q, repos: ["acme/web"] }));
    answer({ config });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await next(user);
    expect(screen.getByText("acme/web")).toBeTruthy();
  });

  it("starts from nothing on a first launch", async () => {
    const config = defaultConfig();
    config.queues = [];
    answer({ config });
    const user = userEvent.setup();
    render(<Setup />);
    await screen.findByText("@octocat");
    await next(user);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
  });

  it("stays as it was when its page draws it again", async () => {
    const read = later<string>();
    answer({ read: () => read.promise });
    const { container, rerender } = render(<Setup />);
    rerender(<Setup />);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await act(async () => {
      read.settle(JSON.stringify(defaultConfig()));
      await Promise.resolve();
    });
    await screen.findByText("@octocat");
    const before = container.innerHTML;
    rerender(<Setup />);
    expect(container.innerHTML).toBe(before);
  });

  it("follows the language picked", async () => {
    answer();
    render(<Setup />);
    await screen.findByText("@octocat");
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
    act(() => {
      setLanguage("en");
    });
  });
});
