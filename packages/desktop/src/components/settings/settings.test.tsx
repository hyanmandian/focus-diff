import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Settings } from "@/components/settings/settings";
import type { AuthStatus } from "@/utils/bridge/bridge";
import { defaultConfig, normalize, type Config, type Queue } from "@/utils/config/config";
import { VERSION, emit, mockCommands } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";

const signedIn: AuthStatus = {
  signed_in: true,
  source: "keychain",
  login: "octocat",
  device_flow: true,
  gh_available: false,
};
const signedOut: AuthStatus = { signed_in: false, source: null, login: null, device_flow: true, gh_available: false };

type Answers = {
  config?: Config;
  auth?: AuthStatus;
  web?: string | null;
  offered?: string | null;
  check?: () => Promise<string | null>;
  install?: () => Promise<void>;
  confirm?: boolean;
  /** Commands that don't answer until `release` is called with them. */
  hold?: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Plays Rust for the settings window: the saved file, who's signed in, updates and alerts. */
function app(answers: Answers = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  const held = new Map<string, () => void>();
  let auth = answers.auth ?? signedIn;
  const answer = (cmd: string): unknown => {
    switch (cmd) {
      case "read_file":
        return JSON.stringify(answers.config ?? defaultConfig());
      case "auth_status":
        return auth;
      case "auth_sign_out":
        auth = signedOut;
        return null;
      case "github_web_session":
        return answers.web ?? null;
      case "update_offered":
        return answers.offered ?? null;
      case "check_update":
        return answers.check?.() ?? null;
      case "install_update":
        return answers.install?.() ?? null;
      case "confirm":
        return answers.confirm ?? true;
      case VERSION:
        return "1.2.3";
      case "ai_statuses":
        return [];
      default:
        return null;
    }
  };
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    if (!answers.hold?.includes(cmd)) return answer(cmd);
    return new Promise((resolve) => {
      held.set(cmd, () => {
        resolve(answer(cmd));
      });
    });
  });
  const saved = (): Config | null => {
    const args = calls.findLast((c) => c.cmd === "write_file")?.args;
    return isRecord(args) && typeof args.contents === "string" ? normalize(JSON.parse(args.contents)) : null;
  };
  const called = (cmd: string) => calls.filter((c) => c.cmd === cmd);
  const release = async (cmd: string) => {
    await act(async () => {
      held.get(cmd)?.();
      await Promise.resolve();
    });
  };
  return { calls, saved, called, release };
}

const queue = (name: string, more: Partial<Queue> = {}): Queue => ({
  ...defaultConfig().queues[0]!,
  id: name,
  name,
  ...more,
});

const config = (more: Partial<Config> = {}): Config => ({ ...defaultConfig(), ...more });

async function open(answers: Answers = {}) {
  const rust = app(answers);
  render(<Settings />);
  await screen.findByRole("tablist", { name: "Settings" });
  return rust;
}

const blocked = () => {
  throw new Error("blocked");
};

/** Opens the window on the General pane. */
const general = (answers: Answers = {}) => {
  localStorage.setItem("settings-pane", "general");
  return open(answers);
};

const search = () => screen.getByRole("searchbox", { name: "Search settings" });

const sidebar = () => screen.getByRole("tablist", { name: "Settings" });
const tab = (name: RegExp | string) => within(sidebar()).getByRole("tab", { name });
const panel = () => screen.getByRole("tabpanel");

afterEach(async () => {
  // Unmounted while the fake platform's mocks are still there, so the event listeners can let go of them.
  cleanup();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  setLanguage("en");
});

describe("Settings window", () => {
  it("shows an empty frame until the settings are read, then the queues", async () => {
    app();
    const { container } = render(<Settings />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(container.querySelectorAll("[data-tauri-drag-region]").length).toBeGreaterThan(0);
    await screen.findByRole("tablist", { name: "Settings" });
    expect(tab(/Queues/u).getAttribute("aria-selected")).toBe("true");
    expect(document.title).toBe("Queues");
    expect(localStorage.getItem("settings-pane")).toBe("queues");
  });

  it("reopens on the pane last used, and on Queues for one it doesn't know", async () => {
    localStorage.setItem("settings-pane", "general");
    await open();
    expect(tab(/General/u).getAttribute("aria-selected")).toBe("true");
    expect(document.title).toBe("General");
  });

  it("falls back to Queues for a pane it doesn't know, or when storage can't be read", async () => {
    localStorage.setItem("settings-pane", "nowhere");
    await open();
    expect(tab(/Queues/u).getAttribute("aria-selected")).toBe("true");
  });

  it("still works when storage refuses", async () => {
    // happy-dom's storage isn't put back by restoreAllMocks, so these are put back by hand.
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(blocked);
    const set = vi.spyOn(localStorage, "setItem").mockImplementation(blocked);
    try {
      await open();
      expect(tab(/Queues/u).getAttribute("aria-selected")).toBe("true");
      await userEvent.click(tab(/General/u));
      expect(document.title).toBe("General");
    } finally {
      cleanup();
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("goes to the pane another window asks for, ignoring one it doesn't have", async () => {
    await open();
    await act(async () => {
      await emit("settings-pane", "ai");
    });
    expect(tab(/AI/u).getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      await emit("settings-pane", "nowhere");
    });
    expect(tab(/AI/u).getAttribute("aria-selected")).toBe("true");
  });

  it.each([
    [/Review time/u, "Review time"],
    [/Filters/u, "Filters"],
    [/Actions/u, "Actions"],
    [/AI/u, "AI"],
    [/octocat/u, "Account"],
  ])("titles the window after the pane chosen in the sidebar (%s)", async (name, title) => {
    await open();
    await userEvent.click(tab(name));
    expect(document.title).toBe(title);
  });
});

describe("Queues pane", () => {
  it("lists the queues and turns one off from its row, saving shortly after", async () => {
    const rust = await open({ config: config({ queues: [queue("Mine"), queue("Theirs")] }) });
    await userEvent.click(within(panel()).getByRole("switch", { name: "Show Mine in the panel" }));
    await waitFor(() => {
      expect(rust.saved()?.queues[0]?.enabled).toBe(false);
    });
  });

  it("says so when there are none", async () => {
    await open({ config: config({ queues: [] }) });
    expect(within(panel()).getByText("No queues yet. Add one to start.")).toBeTruthy();
  });

  it("opens a queue in place, and goes back to its row", async () => {
    await open({ config: config({ queues: [queue("Mine"), queue("Theirs")] }) });
    await userEvent.click(within(panel()).getByRole("button", { name: /Theirs/u }));
    const back = within(panel()).getByRole("button", { name: "Back to Queues" });
    expect(document.activeElement).toBe(back);
    await userEvent.click(back);
    expect(document.activeElement).toBe(within(panel()).getByRole("button", { name: /Theirs/u }));
  });

  it("moves a queue up and down from its detail, the ends staying put", async () => {
    const rust = await open({ config: config({ queues: [queue("One"), queue("Two")] }) });
    await userEvent.click(within(panel()).getByRole("button", { name: /One/u }));
    expect(within(panel()).getByRole("button", { name: "Move up" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(panel()).getByRole("button", { name: "Move down" }));
    await waitFor(() => {
      expect(rust.saved()?.queues.map((q) => q.name)).toEqual(["Two", "One"]);
    });
    expect(within(panel()).getByRole("button", { name: "Move down" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(panel()).getByRole("button", { name: "Move up" }));
    await waitFor(() => {
      expect(rust.saved()?.queues.map((q) => q.name)).toEqual(["One", "Two"]);
    });
  });

  it("hides a queue from the panel from its detail, and says what that means", async () => {
    const rust = await open({ config: config({ queues: [queue("One")] }) });
    await userEvent.click(within(panel()).getByRole("button", { name: /One/u }));
    expect(within(panel()).queryByText(/Hidden:/u)).toBeNull();
    await userEvent.click(within(panel()).getByRole("switch", { name: "Show in the panel" }));
    expect(within(panel()).getByText(/Hidden:/u)).toBeTruthy();
    await waitFor(() => {
      expect(rust.saved()?.queues[0]?.enabled).toBe(false);
    });
  });

  it("deletes a queue only once the alert says Remove", async () => {
    const rust = await open({ config: config({ queues: [queue("One"), queue("Two")] }), confirm: false });
    await userEvent.click(within(panel()).getByRole("button", { name: /One/u }));
    // A queue whose name has been cleared goes by "Untitled queue".
    await userEvent.clear(within(panel()).getByRole("textbox", { name: "Name" }));
    expect(within(panel()).getAllByText("Untitled queue").length).toBeGreaterThan(0);
    await userEvent.click(within(panel()).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(rust.called("confirm")).toHaveLength(1);
    });
    expect(rust.called("confirm")[0]!.args).toMatchObject({ title: "Remove the “Untitled queue” queue?" });
    await userEvent.click(within(panel()).getByRole("button", { name: "Back to Queues" }));
    expect(within(panel()).getByRole("button", { name: /Untitled queue/u })).toBeTruthy();
  });

  it("deletes a queue and goes back to the list when the alert says Remove", async () => {
    const rust = await open({ config: config({ queues: [queue("One"), queue("Two")] }) });
    await userEvent.click(within(panel()).getByRole("button", { name: /One/u }));
    await userEvent.click(within(panel()).getByRole("button", { name: "Delete One" }));
    await waitFor(() => {
      expect(rust.saved()?.queues.map((q) => q.name)).toEqual(["Two"]);
    });
    expect(within(panel()).queryByRole("button", { name: "Back to Queues" })).toBeNull();
  });

  it("adds a queue from a preset or from nothing, and opens it", async () => {
    const rust = await open({ config: config({ queues: [] }) });
    await userEvent.click(within(panel()).getByRole("button", { name: /Add Queue/u }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /My pull requests/u }));
    expect(within(panel()).getByRole("button", { name: "Back to Queues" })).toBeTruthy();
    await waitFor(() => {
      expect(rust.saved()?.queues.map((q) => q.kind)).toEqual(["authored"]);
    });

    await userEvent.click(within(panel()).getByRole("button", { name: "Back to Queues" }));
    await userEvent.click(within(panel()).getByRole("button", { name: /Add Queue/u }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Custom Queue/u }));
    await waitFor(() => {
      expect(rust.saved()?.queues.map((q) => q.kind)).toEqual(["authored", "custom"]);
    });
  });

  it("can't add a thirteenth queue", async () => {
    await open({ config: config({ queues: Array.from({ length: 12 }, (_, i) => queue(`Q${i}`)) }) });
    expect(
      within(panel())
        .getByRole("button", { name: /Add Queue/u })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("Account pane", () => {
  it("waits for who's signed in", async () => {
    localStorage.setItem("settings-pane", "account");
    const rust = await open({ hold: ["auth_status"] });
    expect(within(panel()).getByLabelText("Loading")).toBeTruthy();
    expect(tab(/Not signed in/u)).toBeTruthy();
    await rust.release("auth_status");
    expect(within(panel()).getByText("@octocat")).toBeTruthy();
  });

  it("shows the account signed in, and disconnects it", async () => {
    localStorage.setItem("settings-pane", "account");
    const rust = await open({ web: null });
    expect(await within(panel()).findByText("@octocat")).toBeTruthy();
    expect(within(panel()).getByText("Signed in with GitHub")).toBeTruthy();
    await userEvent.click(within(panel()).getByRole("button", { name: /Disconnect/u }));
    await waitFor(() => {
      expect(rust.called("auth_sign_out")).toHaveLength(1);
    });
    // Signed out, the way to connect again, and no attachments.
    await waitFor(() => {
      expect(within(panel()).queryByText("@octocat")).toBeNull();
    });
    expect(within(panel()).queryByText("Attachments")).toBeNull();
    expect(tab(/Not signed in/u)).toBeTruthy();
  });

  it("says when the GitHub CLI's login is in use", async () => {
    localStorage.setItem("settings-pane", "account");
    await open({ auth: { ...signedIn, source: "gh" } });
    expect(await within(panel()).findByText("Using the GitHub CLI's login")).toBeTruthy();
  });

  it("signs in on github.com for attachments, and out again", async () => {
    localStorage.setItem("settings-pane", "account");
    const rust = await open({ web: null });
    await userEvent.click(await within(panel()).findByRole("button", { name: "Sign in to github.com" }));
    expect(rust.called("sign_in_web")).toHaveLength(1);
    await act(async () => {
      await emit("web-session", "monalisa");
    });
    expect(within(panel()).getByText("@monalisa")).toBeTruthy();
    await userEvent.click(within(panel()).getByRole("button", { name: /Sign Out/u }));
    expect(rust.called("sign_out_web")).toHaveLength(1);
  });

  it("waits for the github.com session", async () => {
    localStorage.setItem("settings-pane", "account");
    await open({ hold: ["github_web_session"] });
    expect(await screen.findByText("Attachments")).toBeTruthy();
    expect(within(panel()).getAllByLabelText("Loading")).toHaveLength(1);
  });
});

describe("General pane", () => {
  it("shows the version, and checks for updates to find it's the latest", async () => {
    await general({ check: () => Promise.resolve(null) });
    expect(await within(panel()).findByText("Focus Diff 1.2.3")).toBeTruthy();
    expect(within(panel()).getByText("Checks for updates on its own; you choose when to install.")).toBeTruthy();
    await userEvent.click(within(panel()).getByRole("button", { name: /Check for Updates/u }));
    expect(await within(panel()).findByText("You have the latest version.")).toBeTruthy();
  });

  it("names the app alone until the version is known", async () => {
    await general({ hold: [VERSION] });
    expect(await screen.findByText("Focus Diff")).toBeTruthy();
  });

  it("finds a newer version, and installs it", async () => {
    const rust = await general({ check: () => Promise.resolve("2.0.0") });
    await userEvent.click(await within(panel()).findByRole("button", { name: /Check for Updates/u }));
    expect(await within(panel()).findByText("Version 2.0.0 is out.")).toBeTruthy();
    const button = within(panel()).getByRole("button", { name: /Update and Restart/u });
    await userEvent.click(button);
    expect(rust.called("install_update")).toHaveLength(1);
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("offers the update found while the window was closed", async () => {
    await general({ offered: "3.0.0" });
    expect(await within(panel()).findByText("Version 3.0.0 is out.")).toBeTruthy();
  });

  it("says when installing fails", async () => {
    await general({
      offered: "3.0.0",
      install: () => Promise.reject(new Error("disk full")),
    });
    await userEvent.click(await within(panel()).findByRole("button", { name: /Update and Restart/u }));
    expect(await within(panel()).findByText(/Couldn't check: .*disk full/u)).toBeTruthy();
    // Back to checking.
    expect(within(panel()).getByRole("button", { name: /Check for Updates/u })).toBeTruthy();
  });

  it("puts a failed check in plain words when no release could be reached", async () => {
    await general({
      check: () => Promise.reject(new Error("error sending request: fetch failed")),
    });
    const check = await within(panel()).findByRole("button", { name: /Check for Updates/u });
    await userEvent.click(check);
    expect(await within(panel()).findByText("Couldn't check: no published release could be reached")).toBeTruthy();
  });

  it("passes on other failures as they are", async () => {
    await general({
      check: () => Promise.reject(new Error("signature mismatch")),
    });
    await userEvent.click(await within(panel()).findByRole("button", { name: /Check for Updates/u }));
    expect(await within(panel()).findByText("Couldn't check: Error: signature mismatch")).toBeTruthy();
  });

  it("turns the notification sound on", async () => {
    const rust = await general();
    await userEvent.click(within(panel()).getByRole("switch", { name: "Play a sound with notifications" }));
    await waitFor(() => {
      expect(rust.saved()?.sound).toBe(true);
    });
  });

  it("follows settings changed elsewhere, but not over a change of its own still being saved", async () => {
    const answers: Answers = { config: config({ sound: false }) };
    const rust = await general(answers);
    const sound = () =>
      within(panel()).getByRole<HTMLButtonElement>("switch", { name: "Play a sound with notifications" });
    expect(sound().getAttribute("aria-checked")).toBe("false");
    answers.config = config({ sound: true });
    await act(() => emit("file-changed", "pace"));
    expect(sound().getAttribute("aria-checked")).toBe("false");
    await act(() => emit("file-changed", "config"));
    await waitFor(() => {
      expect(sound().getAttribute("aria-checked")).toBe("true");
    });
    // Turned off here; setup's older copy, coming in before that's written, doesn't turn it back on.
    await userEvent.click(sound());
    await act(() => emit("file-changed", "config"));
    expect(sound().getAttribute("aria-checked")).toBe("false");
    await waitFor(() => {
      expect(rust.saved()?.sound).toBe(false);
    });
  });

  it("installs the command line, says where, and why not when it can't", async () => {
    const rust = await general();
    const row = () => within(panel()).getByRole("button", { name: /^Install/u });
    expect(row().textContent).toBe("Install");
    mockCommands((cmd) => {
      if (cmd === "install_cli") return "/opt/homebrew/bin/focus-diff";
      return null;
    });
    await userEvent.click(row());
    expect(await within(panel()).findByText("Installed at /opt/homebrew/bin/focus-diff")).toBeTruthy();
    expect(row().textContent).toBe("Install Again");
    mockCommands((cmd) => {
      if (cmd === "install_cli") throw new Error("no folder");
      return null;
    });
    await userEvent.click(row());
    expect((await within(panel()).findByRole("alert")).textContent).toContain("no folder");
    expect(rust.called("cli_installed")).toHaveLength(1);
  });

  it("sends a test notification, with the sound as set", async () => {
    const rust = await general();
    await userEvent.click(within(panel()).getByRole("button", { name: "Send a Test Notification" }));
    expect(rust.called("test_notification").at(-1)?.args).toEqual({ sound: false });
  });

  it("changes how often GitHub is checked, the appearance and the language", async () => {
    const rust = await general();
    await userEvent.click(within(panel()).getByRole("combobox", { name: "Refresh interval" }));
    await userEvent.click(await screen.findByRole("option", { name: "5 minutes" }));
    await waitFor(() => {
      expect(rust.saved()?.pollSeconds).toBe(300);
    });

    await userEvent.click(within(panel()).getByRole("combobox", { name: "Appearance" }));
    await userEvent.click(await screen.findByRole("option", { name: "Dark" }));
    await waitFor(() => {
      expect(rust.saved()?.theme).toBe("dark");
    });
    expect(within(panel()).getByRole("combobox", { name: "Appearance" }).textContent).toContain("Dark");

    await userEvent.click(within(panel()).getByRole("combobox", { name: "Language" }));
    await userEvent.click(await screen.findByRole("option", { name: "Português (Brasil)" }));
    await waitFor(() => {
      expect(rust.saved()?.language).toBe("pt-BR");
    });
    // The window follows at once.
    expect(document.title).toBe("Geral");
  });
});

describe("Searching settings", () => {
  it("narrows the sidebar to the panes that match, showing the setting found", async () => {
    await open();
    await userEvent.type(search(), "theme");
    const found = tab(/General/u);
    expect(found.textContent).toContain("Theme");
    // The first pane that matches opens.
    expect(found.getAttribute("aria-selected")).toBe("true");
    expect(within(sidebar()).queryByRole("tab", { name: /Queues/u })).toBeNull();
  });

  it("finds queues, filters and the like by their own names, without accents or case mattering", async () => {
    await open({ config: config({ queues: [queue("Equipe Pagamentos")] }) });
    await userEvent.type(search(), "PAGAMENTOS");
    expect(tab(/Queues/u).textContent).toContain("Equipe Pagamentos");
    expect(tab(/Queues/u).getAttribute("aria-selected")).toBe("true");

    await userEvent.clear(search());
    await userEvent.type(search(), "portugues");
    expect(tab(/General/u).textContent).toContain("Português");
  });

  it("keeps the open pane when it still matches", async () => {
    localStorage.setItem("settings-pane", "filters");
    await open();
    await userEvent.type(search(), "Filters");
    expect(tab(/Filters/u).getAttribute("aria-selected")).toBe("true");
  });

  it("finds the account by its login, the AI by provider, and says when nothing matches", async () => {
    await open();
    await userEvent.type(search(), "octo");
    expect(tab(/octocat/u).getAttribute("aria-selected")).toBe("true");

    await userEvent.clear(search());
    await userEvent.type(search(), "cursor");
    expect(tab(/AI/u).textContent).toContain("Cursor");

    await userEvent.clear(search());
    await userEvent.type(search(), "zzz ");
    expect(screen.getByRole("status").textContent).toBe("No settings match “zzz”.");
  });

  it("clears with Escape or the clear button, and moves into the results with ↓ or Return", async () => {
    await open();
    await userEvent.type(search(), "theme");
    await userEvent.keyboard("{Escape}");
    expect(search()).toHaveProperty("value", "");
    // Escape on an empty field is left to the window.
    await userEvent.keyboard("{Escape}");

    await userEvent.type(search(), "theme");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(search()).toHaveProperty("value", "");
    expect(document.activeElement).toBe(search());

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(tab(/General/u));
    search().focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(tab(/General/u));
    search().focus();
    await userEvent.keyboard("a");
  });

  it("goes to the first result, selected or not, from the field", async () => {
    await open();
    await userEvent.type(search(), "zzz");
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(search());
  });

  it("jumps to the field with ⌘F", async () => {
    await open();
    await userEvent.click(tab(/General/u));
    fireEvent.keyDown(window, { key: "F", metaKey: true });
    expect(document.activeElement).toBe(search());
    fireEvent.keyDown(window, { key: "f" });
  });

  it("searches in the language in use and in English too", async () => {
    setLanguage("pt-BR");
    app();
    render(<Settings />);
    await userEvent.type(await screen.findByRole("searchbox"), "Dark");
    expect(within(screen.getByRole("tablist")).getByRole("tab", { name: /Geral/u })).toBeTruthy();
  });
});

describe("re-rendering", () => {
  // The React Compiler keeps each part until what it's made from changes: rendered again, or in
  // another language and back, every pane shows what it did.
  it.each(["queues", "review", "filters", "actions", "ai", "account", "general"])(
    "shows the %s pane the same after rendering again and a trip through another language",
    async (pane) => {
      localStorage.setItem("settings-pane", pane);
      app({ config: config({ queues: [queue("One"), queue("Two", { enabled: false })] }), web: "monalisa" });
      const { container, rerender } = render(<Settings />);
      await screen.findByRole("tablist", { name: "Settings" });
      await waitFor(() => {
        expect(container.querySelector(".animate-spin")).toBeNull();
      });
      const before = container.innerHTML;
      rerender(<Settings />);
      act(() => {
        setLanguage("pt-BR");
      });
      act(() => {
        setLanguage("en");
      });
      expect(container.innerHTML).toBe(before);
    },
  );
});
