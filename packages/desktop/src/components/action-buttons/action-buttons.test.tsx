import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ActionButtons, ActionMenuItems } from "@/components/action-buttons/action-buttons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/dropdown-menu/dropdown-menu";
import type { ActionContext } from "@/utils/bridge/bridge";
import type { Action } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { deferred } from "@/utils/mock-render/mock-render";

type Run = (action: Action, pr: ActionContext) => Promise<string>;
const runner = vi.hoisted(() => ({ run: vi.fn<Run>() }));
vi.mock("@/utils/actions/actions", async (original) => {
  const actual = await original<{ runAction: Run }>();
  runner.run.mockImplementation(actual.runAction);
  return { ...actual, runAction: runner.run };
});

const PR: ActionContext = {
  number: 42,
  repo: "acme/api",
  title: "Rename the queue",
  url: "https://github.com/acme/api/pull/42",
  author: "mona",
  me: "hubot",
};

const action = (over: Partial<Action> = {}): Action => ({
  id: "docs",
  name: "Docs",
  confirm: false,
  steps: [{ kind: "open", url: "https://docs.example.com/{number}" }],
  choices: [],
  ...over,
});

const DELEGATE = action({
  id: "delegate",
  name: "Delegate",
  confirm: true,
  steps: [],
  choices: [
    { id: "to-mona", name: "Mona", steps: [{ kind: "request", reviewers: ["mona"] }] },
    { id: "to-team", name: "Platform", steps: [] },
  ],
});

function rust({ confirm = true, open }: { confirm?: boolean; open?: () => unknown } = {}) {
  const calls: Array<[string, unknown]> = [];
  mockCommands((cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "confirm") return confirm;
    if (cmd === "open_url") return open?.() ?? null;
    if (cmd === "github") return { status: 201, body: "{}" };
    return null;
  });
  return calls;
}

type Result = (message: string, ok: boolean) => void;
let onResult = vi.fn<Result>();
beforeEach(() => {
  onResult = vi.fn<Result>();
});

describe("ActionButtons", () => {
  it("shows nothing without a pull request or actions", () => {
    const { container, rerender } = render(<ActionButtons actions={[action()]} pr={null} onResult={onResult} />);
    expect(container.textContent).toBe("");
    rerender(<ActionButtons actions={[]} pr={PR} onResult={onResult} />);
    expect(container.textContent).toBe("");
  });

  it("runs an action's steps and says it's done", async () => {
    const calls = rust();
    render(<ActionButtons actions={[action()]} pr={PR} onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Docs: done", true);
    });
    expect(calls).toContainEqual(["open_url", { url: "https://docs.example.com/42" }]);
    expect(calls.map(([cmd]) => cmd)).not.toContain("confirm");
  });

  it("is busy while it runs", async () => {
    const opened = deferred();
    rust({ open: () => opened.promise });
    render(<ActionButtons actions={[action()]} pr={PR} onResult={onResult} />);
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Docs" });
    await userEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    opened.resolve();
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });

  it("says what failed", async () => {
    rust({
      open: () => {
        throw new Error("No browser");
      },
    });
    render(<ActionButtons actions={[action()]} pr={PR} onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("No browser", false);
    });
  });

  it("says what failed even when it isn't an Error", async () => {
    rust();
    runner.run.mockRejectedValueOnce("Gone");
    render(<ActionButtons actions={[action()]} pr={PR} onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Gone", false);
    });
  });

  it("asks first when set to, naming each step, and runs only on OK", async () => {
    const steps: Action["steps"] = [
      { kind: "request", reviewers: ["mona", "acme/platform"] },
      { kind: "request", reviewers: [] },
      { kind: "label", labels: ["ready"] },
      { kind: "label", labels: [] },
      { kind: "comment", body: "" },
    ];
    const calls = rust({ confirm: false });
    const { rerender } = render(
      <ActionButtons actions={[action({ name: "Ship", confirm: true, steps })]} pr={PR} onResult={onResult} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ship…" }));
    await waitFor(() => {
      expect(calls.map(([cmd]) => cmd)).toContain("confirm");
    });
    expect(calls.find(([cmd]) => cmd === "confirm")?.[1]).toEqual({
      title: "Ship #42?",
      message: "Ask for reviews: mona, acme/platform\nAsk for reviews\nAdd labels: ready\nAdd labels\nComment",
      ok: "Ship",
    });
    expect(onResult).not.toHaveBeenCalled();

    rust({ confirm: true });
    rerender(<ActionButtons actions={[action({ name: "Ship", confirm: true, steps })]} pr={PR} onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Ship…" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Ship: done", true);
    });
  });

  it("can't run an action with no steps", () => {
    render(<ActionButtons actions={[action({ steps: [] })]} pr={PR} onResult={onResult} />);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Docs" }).disabled).toBe(true);
  });

  it("draws a menu action as a pull-down of its choices", async () => {
    const calls = rust();
    render(<ActionButtons actions={[DELEGATE]} pr={PR} onResult={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Delegate" }));
    expect((await screen.findByRole("menuitem", { name: "Platform…" })).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Mona…" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Delegate · Mona: done", true);
    });
    expect(calls.find(([cmd]) => cmd === "confirm")?.[1]).toMatchObject({ title: "Delegate · Mona #42?" });
  });
});

function Menu({ actions, pr = PR, onDone }: { actions: Action[]; pr?: ActionContext | null; onDone: Result }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ActionMenuItems actions={actions} pr={pr} onResult={onDone} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("ActionMenuItems", () => {
  it("lists nothing without a pull request or actions", async () => {
    const { rerender } = render(<Menu actions={[action()]} pr={null} onDone={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.queryByRole("menuitem")).toBeNull();
    rerender(<Menu actions={[]} onDone={onResult} />);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("runs an action from the menu, and a menu action's choice from its submenu", async () => {
    rust();
    render(<Menu actions={[action(), DELEGATE]} onDone={onResult} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Docs" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Docs: done", true);
    });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delegate" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mona…" }));
    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith("Delegate · Mona: done", true);
    });
  });
});
