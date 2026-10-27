import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Actions } from "@/components/settings-actions/settings-actions";
import { defaultConfig, type Action, type ActionStep, type Config } from "@/utils/config/config";
import { fakePlatform, mockCommands } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";
import { setPlatform } from "@/utils/platform/platform";

afterEach(() => {
  setLanguage("en");
});

/** Switches the app's language while the pane is on screen. */
const speak = (language: "en" | "pt-BR") => {
  act(() => {
    setLanguage(language);
  });
};

const action = (patch: Partial<Action> = {}): Action => ({
  id: "a1",
  name: "Ping",
  confirm: false,
  steps: [],
  choices: [],
  ...patch,
});

/** The question a "confirm" call asks. */
function titleOf(args: unknown): string {
  if (typeof args === "object" && args !== null && "title" in args && typeof args.title === "string") return args.title;
  return "";
}

/** The pane as Settings holds it: each change kept, the latest readable, and the answer to
 *  "Remove …?" given by `confirm`. */
function setup(actions: Action[], confirm = true) {
  const asked: string[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "confirm") {
      asked.push(titleOf(args));
      return confirm;
    }
    return null;
  });
  const changes = vi.fn<(c: Config) => void>();
  function Harness() {
    const [config, setConfig] = useState<Config>({ ...defaultConfig(), actions });
    return (
      <Actions
        config={config}
        onChange={(c) => {
          changes(c);
          setConfig(c);
        }}
      />
    );
  }
  render(<Harness />, { wrapper: StrictMode });
  const last = () => changes.mock.lastCall![0];
  const current = () => last().actions[0]!;
  return { user: userEvent.setup(), changes, last, current, asked };
}

const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${name}`, "u") }));
};

const addStep = async (user: ReturnType<typeof userEvent.setup>, kind: string) => {
  await user.click(screen.getByRole("button", { name: "Add Step" }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${kind}`, "u") }));
};

describe("Actions", () => {
  it("starts empty, and adding one opens it as a script", async () => {
    const { user, last } = setup([]);
    expect(screen.getByText("Your own buttons on pull requests")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add an action" }));
    expect(last().actions).toHaveLength(1);
    expect(last().actions[0]).toMatchObject({ name: "Script", steps: [{ kind: "run", command: 'echo "$PR_URL"' }] });
    expect(screen.getByRole("textbox", { name: "Button" })).toHaveProperty("value", "Script");

    await user.click(screen.getByRole("button", { name: "Back to Actions" }));
    expect(screen.getByRole("button", { name: /^Script/u }).textContent).toContain("Run a command");
  });

  it("sums up each action in its row", () => {
    setup([
      action({
        id: "1",
        name: "Hand off",
        steps: [
          { kind: "comment", body: "" },
          { kind: "request", reviewers: [] },
        ],
      }),
      action({ id: "2", name: "", steps: [] }),
      action({
        id: "3",
        name: "Delegate",
        choices: [
          { id: "c1", name: "Ana", steps: [] },
          { id: "c2", name: "Bo", steps: [] },
        ],
      }),
    ]);
    expect(screen.getByRole("button", { name: /^Hand off/u }).textContent).toContain("Comment, then ask for reviews");
    expect(screen.getByRole("button", { name: /^Untitled action/u }).textContent).toContain("No steps yet");
    expect(screen.getByRole("button", { name: /^Delegate/u }).textContent).toContain("Menu: Ana, Bo");
  });

  it("can't add more than 12 actions", () => {
    setup(Array.from({ length: 12 }, (_, i) => action({ id: String(i), name: `A${i}` })));
    expect(screen.getByRole("button", { name: "Add an action" })).toHaveProperty("disabled", true);
  });

  it("adds an action from the list's own button", async () => {
    const { user, last } = setup([action()]);
    await user.click(screen.getByRole("button", { name: "Add an action" }));
    expect(last().actions).toHaveLength(2);
  });

  it("renames an action and asks before running it", async () => {
    const { user, current, last } = setup([action(), action({ id: "a2", name: "Other" })]);
    await open(user, "Ping");
    const name = screen.getByRole("textbox", { name: "Button" });
    await user.clear(name);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Untitled action");
    await user.type(name, "Pong");
    expect(current().name).toBe("Pong");
    await user.click(screen.getByRole("switch", { name: /Ask me to confirm/u }));
    expect(current().confirm).toBe(true);
    expect(last().actions[1]!.name).toBe("Other");
  });

  it("adds each kind of step and edits it", async () => {
    const { user, current } = setup([action()]);
    await open(user, "Ping");

    await addStep(user, "Comment");
    await user.type(screen.getByRole("textbox", { name: "Comment" }), "Hi");
    expect(current().steps[0]).toEqual({ kind: "comment", body: "Hi" });

    await addStep(user, "Ask for reviews");
    const reviewers = screen.getByRole("textbox", { name: "Reviewers" });
    await user.type(reviewers, "not ok!{Enter}");
    expect(screen.getByText("A username, or organization/team")).toBeTruthy();
    await user.clear(reviewers);
    await user.type(reviewers, "acme/web{Enter}");
    expect(current().steps[1]).toEqual({ kind: "request", reviewers: ["acme/web"] });

    await addStep(user, "Take me off the review");
    expect(current().steps[2]).toEqual({ kind: "unrequestMe" });

    await addStep(user, "Add labels");
    await user.type(screen.getByRole("textbox", { name: "Labels" }), "bug{Enter}");
    expect(current().steps[3]).toEqual({ kind: "label", labels: ["bug"] });

    await addStep(user, "Open a link");
    const link = screen.getByRole("textbox", { name: "Link" });
    expect(link).toHaveProperty("value", "https://");
    await user.type(link, "x.dev");
    expect(current().steps[4]).toEqual({ kind: "open", url: "https://x.dev" });

    await addStep(user, "Run a command");
    await user.type(screen.getByRole("textbox", { name: "Command" }), "ls");
    expect(current().steps[5]).toEqual({ kind: "run", command: "ls" });
    expect(screen.getByRole("heading", { name: "Steps" }).closest("section")?.textContent).toContain(
      "Take me off the review",
    );
  });

  it("moves and removes steps, up to ten of them", async () => {
    const steps: ActionStep[] = [
      { kind: "run", command: "one" },
      { kind: "run", command: "two" },
    ];
    const { user, current } = setup([action({ steps })]);
    await open(user, "Ping");
    const [up] = screen.getAllByRole("button", { name: "Move up" });
    expect(up).toHaveProperty("disabled", true);
    expect(screen.getAllByRole("button", { name: "Move down" })[1]).toHaveProperty("disabled", true);

    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    expect(current().steps).toEqual([steps[1], steps[0]]);
    await user.click(screen.getAllByRole("button", { name: "Move up" })[1]!);
    expect(current().steps).toEqual(steps);

    await user.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(current().steps).toEqual([{ kind: "run", command: "two" }]);
  });

  it("can't have more than ten steps", async () => {
    const steps: ActionStep[] = Array.from({ length: 9 }, () => ({ kind: "unrequestMe" }));
    const { user, current } = setup([action({ steps })]);
    await open(user, "Ping");
    await addStep(user, "Take me off the review");
    expect(current().steps).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Add Step" })).toHaveProperty("disabled", true);
  });

  it("turns a button into a menu whose first choice has its steps, and back", async () => {
    const steps: ActionStep[] = [{ kind: "run", command: "go" }];
    const { user, current, asked } = setup([action({ steps })]);
    await open(user, "Ping");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(current().steps).toEqual([]);
    expect(current().choices).toHaveLength(1);
    expect(current().choices[0]).toMatchObject({ name: "Choice 1", steps });

    // Picking what it already is changes nothing.
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(current().choices).toHaveLength(1);

    // One choice: no question, its steps stay.
    await user.click(screen.getByRole("button", { name: "Button" }));
    expect(asked).toEqual([]);
    expect(current()).toMatchObject({ steps, choices: [] });
  });

  it("offers no commands where the app can't run them (the browser extension): a comment to start", async () => {
    setPlatform({ ...fakePlatform, features: { commands: false } });
    const { user, last, current } = setup([]);
    await user.click(screen.getByRole("button", { name: "Add an action" }));
    expect(last().actions[0]!.steps).toEqual([{ kind: "comment", body: "" }]);
    await user.click(screen.getByRole("button", { name: "Add Step" }));
    await screen.findByRole("menuitem", { name: /^Comment/u });
    expect(screen.queryByRole("menuitem", { name: /^Run a command/u })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(current().choices[0]!.steps).toEqual([{ kind: "comment", body: "" }]);
  });

  it("starts a menu from an empty button with a command to run", async () => {
    const { user, current } = setup([action()]);
    await open(user, "Ping");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(current().choices[0]!.steps).toEqual([{ kind: "run", command: "" }]);
  });

  it("asks before dropping a menu's other choices, and keeps them when told no", async () => {
    const choices = [
      { id: "c1", name: "Ana", steps: [{ kind: "unrequestMe" } as const] },
      { id: "c2", name: "Bo", steps: [] },
    ];
    const kept = setup([action({ choices })], false);
    await open(kept.user, "Ping");
    await kept.user.click(screen.getByRole("button", { name: "Button" }));
    await waitFor(() => {
      expect(kept.asked).toEqual(["Make it a button and remove the other choice?"]);
    });
    expect(kept.changes).not.toHaveBeenCalled();
  });

  it("drops a menu's other choices once told yes", async () => {
    const choices = [
      { id: "c1", name: "Ana", steps: [{ kind: "unrequestMe" } as const] },
      { id: "c2", name: "Bo", steps: [] },
    ];
    const { user, current } = setup([action({ choices })]);
    await open(user, "Ping");
    await user.click(screen.getByRole("button", { name: "Button" }));
    await waitFor(() => {
      expect(current()).toMatchObject({ steps: [{ kind: "unrequestMe" }], choices: [] });
    });
  });

  it("edits, moves, adds and removes a menu's choices", async () => {
    const choices = [
      { id: "c1", name: "Ana", steps: [] },
      { id: "c2", name: "", steps: [] },
    ];
    const { user, current, asked } = setup([action({ choices })]);
    await open(user, "Ping");
    expect(screen.getByRole("heading", { name: "Untitled action" })).toBeTruthy();

    const ana = screen.getByRole("heading", { name: "Ana" }).closest("section")!;
    await user.type(within(ana).getByRole("textbox", { name: "Name" }), "!");
    expect(current().choices[0]!.name).toBe("Ana!");
    await user.click(within(ana).getByRole("button", { name: "Add Step" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Take me off/u }));
    expect(current().choices[0]!.steps).toEqual([{ kind: "unrequestMe" }]);

    expect(within(ana).getAllByRole("button", { name: "Move up" })[0]).toHaveProperty("disabled", true);
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    expect(current().choices.map((c) => c.id)).toEqual(["c2", "c1"]);
    await user.click(screen.getAllByRole("button", { name: "Move up" })[1]!);
    expect(current().choices.map((c) => c.id)).toEqual(["c1", "c2"]);

    await user.click(screen.getByRole("button", { name: "Add Choice" }));
    expect(current().choices[2]).toMatchObject({ name: "Choice 3", steps: [{ kind: "run", command: "" }] });

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(current().choices.map((c) => c.id)).toEqual(["c1", expect.any(String)]);
    });
    expect(asked).toEqual(["Remove “Untitled action”?"]);
  });

  it("keeps a choice when its removal isn't confirmed", async () => {
    const { user, changes, asked } = setup([action({ choices: [{ id: "c1", name: "Ana", steps: [] }] })], false);
    await open(user, "Ping");
    await user.click(screen.getByRole("button", { name: "Remove Ana" }));
    await waitFor(() => {
      expect(asked).toEqual(["Remove “Ana”?"]);
    });
    expect(changes).not.toHaveBeenCalled();
  });

  it("becomes an empty button when its last choice goes", async () => {
    const { user, current } = setup([
      action({ steps: [{ kind: "unrequestMe" }], choices: [{ id: "c1", name: "Ana", steps: [] }] }),
    ]);
    await open(user, "Ping");
    await user.click(screen.getByRole("button", { name: "Remove Ana" }));
    await waitFor(() => {
      expect(current()).toMatchObject({ steps: [], choices: [] });
    });
  });

  it("can't have more than 12 choices", async () => {
    const choices = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, steps: [] }));
    const { user } = setup([action({ choices })]);
    await open(user, "Ping");
    expect(screen.getByRole("button", { name: "Add Choice" })).toHaveProperty("disabled", true);
  });

  it("deletes an action once confirmed, back on the list", async () => {
    const { user, last, asked } = setup([action({ name: "" })]);
    await open(user, "Untitled action");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(last().actions).toEqual([]);
    });
    expect(asked).toEqual(["Remove the “Untitled action” action?"]);
    expect(screen.getByText("Your own buttons on pull requests")).toBeTruthy();
  });

  it("keeps an action when its deletion isn't confirmed", async () => {
    const { user, changes, asked } = setup([action()], false);
    await open(user, "Ping");
    await user.click(screen.getByRole("button", { name: "Delete Ping" }));
    await waitFor(() => {
      expect(asked).toHaveLength(1);
    });
    expect(changes).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Button" })).toBeTruthy();
  });

  it("rewords the list when the language changes", () => {
    setup([action({ steps: [{ kind: "comment", body: "" }] })]);
    speak("pt-BR");
    expect(screen.getByRole("button", { name: /^Ping/u }).textContent).toContain("Comentar");
    speak("en");
    expect(screen.getByRole("button", { name: /^Ping/u }).textContent).toContain("Comment");
  });

  it("rewords an open action's steps and choices when the language changes", async () => {
    const steps: ActionStep[] = [
      { kind: "comment", body: "" },
      { kind: "request", reviewers: [] },
      { kind: "unrequestMe" },
      { kind: "label", labels: [] },
      { kind: "open", url: "" },
      { kind: "run", command: "" },
    ];
    const { user } = setup([
      action({ id: "1", steps }),
      action({ id: "2", name: "Menu", choices: [{ id: "c1", name: "Ana", steps }] }),
    ]);
    await open(user, "Ping");
    speak("pt-BR");
    expect(screen.getByRole("button", { name: "Adicionar passo" })).toBeTruthy();
    speak("en");
    await user.click(screen.getByRole("button", { name: "Back to Actions" }));
    await open(user, "Menu");
    speak("pt-BR");
    expect(screen.getByRole("button", { name: "Adicionar opção" })).toBeTruthy();
  });
});
