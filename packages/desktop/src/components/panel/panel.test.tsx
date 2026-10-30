import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Panel } from "@/components/panel/panel";
import { defaultConfig, TEMPLATES, type Config, type Queue, type QueueKind } from "@/utils/config/config";
import type { Event, Item, PullRequest } from "@/utils/engine/engine";
import { emit, mockCommands, VERSION } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";
import { fakeOs } from "@/utils/mock-os/mock-os";
import { refuseStorage } from "@/utils/mock-render/mock-render";
import { start, type ReviewRun, type Status } from "@/utils/store/store";

vi.mock("@/utils/os/os", async (original) =>
  (await import("@/utils/mock-os/mock-os")).withFakeOs(await original<object>()),
);

const HOUR = 3_600_000;
let serial = 0;

function pr(over: Partial<PullRequest> = {}): PullRequest {
  serial += 1;
  return {
    id: `PR_${serial}`,
    number: 2000 + serial,
    title: `Pull request ${serial}`,
    url: `https://github.com/acme/web/pull/${2000 + serial}`,
    isDraft: false,
    state: "OPEN",
    createdAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    updatedAt: new Date(Date.now() - 3 * HOUR).toISOString(),
    mergedAt: null,
    headRefOid: "abc",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    repository: { nameWithOwner: "acme/web" },
    author: { login: "ana" },
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    comments: 0,
    ...over,
  };
}

function item(
  queueId: string,
  title: string,
  repo = "acme/web",
  over: Partial<Item> = {},
  pull: Partial<PullRequest> = {},
) {
  const made = pr({ title, repository: { nameWithOwner: repo }, ...pull });
  const events: Event[] = [{ key: `${queueId}:${made.id}:new`, kind: "new", at: Date.now() - HOUR, who: null }];
  return { queueId, pr: made, events, ci: null, ...over } satisfies Item;
}

const queue = (kind: QueueKind, id: string, over: Partial<Queue> = {}): Queue => ({
  ...TEMPLATES[kind].make(),
  id,
  ...over,
});

function makeConfig(queues: Queue[]): Config {
  return { ...defaultConfig(), queues };
}

const QUEUES = [
  queue("review", "review", { name: "Review" }),
  queue("involved", "involved", { name: "Involved" }),
  queue("authored", "authored", { name: "Mine" }),
  queue("merged", "merged", { name: "Merged", enabled: false }),
];

type Live = {
  ready: boolean;
  signedIn: boolean;
  me: string | null;
  items: Record<string, Item[]>;
  status: Status;
  arrivals: string[];
  seen: Record<string, true>;
  dismissed: Record<string, true>;
  review: ReviewRun | null;
};

const live = (over: Partial<Live> = {}): Live => ({
  ready: true,
  signedIn: true,
  me: "me",
  items: {},
  status: { phase: "idle", updatedAt: Date.now() - 10_000 },
  arrivals: [],
  seen: {},
  dismissed: {},
  review: null,
  ...over,
});

function seenAll(...items: Item[]) {
  const seen: Record<string, true> = {};
  for (const e of items.flatMap((i) => i.events)) seen[e.key] = true;
  return seen;
}

type Options = {
  config?: Config;
  github?: unknown;
  waiting?: string;
  update?: string | null;
  failInstall?: boolean;
  strict?: boolean;
  version?: string;
};

async function setup(
  state: Live,
  { config = makeConfig(QUEUES), update = null, failInstall, strict, github, waiting, version }: Options = {},
) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "read_file": {
        return args && "name" in args && args.name === "config" ? JSON.stringify(config) : null;
      }
      case "snapshot": {
        return state;
      }
      case "update_offered": {
        return update;
      }
      case "auth_status": {
        return {
          signed_in: false,
          source: null,
          login: null,
          device_flow: true,
          gh_available: true,
          gh_signed_in: true,
        };
      }
      case "take_link": {
        if (waiting === "refused") throw new Error("no such command");
        return waiting ?? null;
      }
      case "github": {
        return { status: 200, body: JSON.stringify({ data: github ?? null }) };
      }
      case "install_update": {
        if (failInstall) throw new Error("offline");
        return null;
      }
      case VERSION: {
        return version ?? null;
      }
      default: {
        return null;
      }
    }
  });
  const view = render(<Panel />, strict === false ? undefined : { wrapper: StrictMode });
  await act(async () => {
    await start();
  });
  return { calls, view, user: userEvent.setup(), cmds: () => calls.map((c) => c.cmd) };
}

const snapshot = async (state: Live) => {
  await act(async () => {
    await emit("snapshot", state);
  });
};

const fetchedAhead = (calls: Array<{ cmd: string; args: unknown }>, one: Item) =>
  calls.some((c) => c.cmd === "github" && JSON.stringify(c.args).includes(String(one.pr.number)));

const footer = () => document.querySelector("footer")!;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
});

afterEach(async () => {
  fakeOs.mac = true;
  Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
  vi.useRealTimers();
  cleanup();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
});

describe("Panel", () => {
  it("shows the shape of what's coming until the app is ready", async () => {
    await setup(live({ ready: false, signedIn: false }));
    expect(screen.getByLabelText("Loading").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("offers to connect GitHub when no one is signed in, and refreshes once connected", async () => {
    const { user, calls } = await setup(live({ signedIn: false }));
    expect(screen.getByRole("heading", { name: "Your reviews, without opening GitHub" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Use the GitHub CLI's login" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ cmd: "refresh", args: { force: true } });
    });
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("sends you to Settings when no queue is turned on", async () => {
    const { user, cmds } = await setup(live(), { config: makeConfig([queue("review", "r", { enabled: false })]) });
    expect(screen.getByText("You have no queues turned on.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Set Up Queues…" }));
    expect(cmds()).toContain("open_settings");
  });

  it("shows the queues as tabs with their counts, starting on the first with something unread", async () => {
    const mine = item("authored", "Mine to merge");
    const involved = item("involved", "Talked about");
    await setup(live({ items: { authored: [mine], involved: [involved] }, seen: seenAll(involved) }));
    const tabs = within(screen.getByRole("tablist", { name: "Queues" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Review0", "Involved1", "Mine1"]);
    expect(screen.getByRole("tab", { name: /Mine/u }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Mine" })).toBeTruthy();
    expect(screen.getByText("Mine to merge")).toBeTruthy();
  });

  it("starts on the first queue when nothing is unread", async () => {
    await setup(live());
    expect(screen.getByRole("tab", { name: /Review/u }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Nothing waiting on your review.")).toBeTruthy();
  });

  it("switches queues and remembers the one picked for next time", async () => {
    const involved = item("involved", "Talked about");
    const { user, view } = await setup(live({ items: { involved: [involved] }, seen: seenAll(involved) }));
    await user.click(screen.getByRole("tab", { name: /Mine/u }));
    expect(screen.getByText("You have no open pull requests.")).toBeTruthy();
    expect(localStorage.getItem("tab")).toBe("authored");
    view.unmount();

    await setup(live({ items: { involved: [involved] } }));
    expect(screen.getByRole("tab", { name: /Mine/u }).getAttribute("aria-selected")).toBe("true");
  });

  it("still works when storage can't be used", async () => {
    const { get, set } = refuseStorage();
    const { user } = await setup(live());
    await user.click(screen.getByRole("tab", { name: /Involved/u }));
    expect(screen.getByRole("tab", { name: /Involved/u }).getAttribute("aria-selected")).toBe("true");
    get.mockRestore();
    set.mockRestore();
  });

  it("groups the pull requests by repository, with chips to narrow to one, busiest first", async () => {
    const web1 = item("review", "Web one");
    const web2 = item("review", "Web two");
    const api = item("review", "Api one", "acme/api");
    const { user } = await setup(live({ items: { review: [api, web1, web2] } }));
    const chips = within(screen.getByRole("group", { name: "Repositories" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All3", "web2", "api1"]);
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "acme/web" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "acme/api" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^api/u }));
    expect(screen.queryByText("Web one")).toBeNull();
    expect(screen.getByText("Api one")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^api/u }).getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: /^All/u }));
    expect(screen.getByText("Web one")).toBeTruthy();
  });

  it("keeps a stack together, bottom first, in a group of its own, drafts too", async () => {
    const top = item("review", "Top", "acme/web", {}, { headRefName: "b", baseRefName: "a" });
    const lone = item("review", "Lone");
    const bottom = item("review", "Bottom", "acme/web", {}, { headRefName: "a", baseRefName: "main" });
    const drafts = [
      item("review", "Draft up", "acme/web", {}, { isDraft: true, headRefName: "d2", baseRefName: "d1" }),
      item("review", "Draft down", "acme/web", {}, { isDraft: true, headRefName: "d1", baseRefName: "main" }),
    ];
    const { user } = await setup(live({ items: { review: [top, lone, bottom, ...drafts] } }));
    const stack = screen.getByRole("list", { name: "Stack of 2" });
    expect(
      within(stack)
        .getAllByText(/^(Top|Bottom)$/u)
        .map((title) => title.textContent),
    ).toEqual(["Bottom", "Top"]);
    expect(within(stack).getByText("1 of 2 in a stack, from the bottom")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Drafts/u }));
    expect(screen.getAllByRole("list", { name: "Stack of 2" })).toHaveLength(2);
  });

  it("opens the link sheet with Ctrl+O off the Mac", async () => {
    fakeOs.mac = false;
    await setup(live());
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(await screen.findByRole("textbox", { name: "Pull request link" })).toBeTruthy();
  });

  it("opens a pull request from its link: Open Pull Request… in the menu or ⌘O, pasted, or sent", async () => {
    const found = { repository: { pullRequest: { id: "PR_9", number: 9, title: "Nine", author: null } } };
    const { user, calls } = await setup(live(), { github: found });
    const opened = () => calls.filter((c) => c.cmd === "open_review").map((c) => JSON.stringify(c.args));

    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Open Pull Request/u }));
    const field = await screen.findByRole("textbox", { name: "Pull request link" });
    await user.type(field, "not a link{Enter}");
    expect(screen.getByRole("alert").textContent).toBe("That isn't a pull request's link on GitHub.");
    await user.clear(field);
    await user.type(field, "https://github.com/acme/web/pull/9/files{Enter}");
    await waitFor(() => {
      expect(opened()).toEqual([expect.stringContaining('"id":"PR_9"')]);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "o", metaKey: true });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const paste = (text: string, target: EventTarget = document.body) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.assign(event, { clipboardData: { getData: () => text } });
      target.dispatchEvent(event);
      return event;
    };
    await act(async () => {
      expect(paste("https://github.com/acme/web/pull/9").defaultPrevented).toBe(true);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(opened()).toHaveLength(2);
    });
    expect(paste("just words").defaultPrevented).toBe(false);
    const empty = new Event("paste", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    const input = document.createElement("input");
    document.body.append(input);
    expect(paste("https://github.com/acme/web/pull/9", input).defaultPrevented).toBe(false);
    input.remove();
    await act(async () => {
      paste("https://github.com/acme/web/issues/9");
      await Promise.resolve();
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Pull request link" }).value).toBe(
      "https://github.com/acme/web/issues/9",
    );
    expect(calls.some((c) => c.cmd === "open_panel")).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await act(() => emit("open-link", "https://github.com/acme/web/pull/9"));
    await waitFor(() => {
      expect(opened()).toHaveLength(3);
    });
  });

  it("starts as usual when asking for a waiting link fails", async () => {
    const { calls } = await setup(live(), { waiting: "refused" });
    expect(screen.getByRole("tablist", { name: "Queues" })).toBeTruthy();
    expect(calls.some((c) => c.cmd === "open_review")).toBe(false);
  });

  it("opens a link sent from outside before it was open", async () => {
    const { calls } = await setup(live(), { waiting: "https://github.com/acme/web/issues/3" });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls.some((c) => c.cmd === "open_review")).toBe(false);
  });

  it("names repositories in full when two owners have one by the same name", async () => {
    await setup(live({ items: { review: [item("review", "A", "acme/web"), item("review", "B", "ours/web")] } }));
    const chips = within(screen.getByRole("group", { name: "Repositories" })).getAllByRole("button");
    expect(chips.map((c) => c.getAttribute("title"))).toEqual([null, "acme/web", "ours/web"]);
    expect(chips.map((c) => c.textContent)).toEqual(["All2", "acme/web1", "ours/web1"]);
  });

  it("goes back to all repositories when the one picked has gone from the queue", async () => {
    const web = item("review", "Web one");
    const api = item("review", "Api one", "acme/api");
    const { user } = await setup(live({ items: { review: [web, api] } }));
    await user.click(screen.getByRole("button", { name: /^api/u }));
    await snapshot(live({ items: { review: [web, item("review", "Docs", "acme/docs")] } }));
    expect(screen.getByRole("button", { name: /^All/u }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Web one")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
  });

  it("folds drafts at the end, and opens them on a click", async () => {
    const draft = item("review", "Half done", "acme/web", {}, { isDraft: true });
    const { user } = await setup(live({ items: { review: [item("review", "Ready"), draft] } }));
    const trigger = screen.getByRole("button", { name: /Drafts/u });
    expect(trigger.textContent).toContain("1");
    expect(screen.queryByText("Half done")).toBeNull();
    await user.click(trigger);
    expect(screen.getByText("Half done")).toBeTruthy();
  });

  it("shows only drafts when that's all there is", async () => {
    const { user } = await setup(
      live({ items: { review: [item("review", "Half done", "acme/web", {}, { isDraft: true })] } }),
    );
    await user.click(screen.getByRole("button", { name: /Drafts/u }));
    expect(screen.getByText("Half done")).toBeTruthy();
  });

  it("opens a pull request's review window and counts it as seen", async () => {
    const one = item("review", "Open me", "acme/web", { viaTeams: ["acme/web-team"] });
    const { user, calls } = await setup(live({ items: { review: [one] } }));
    await user.click(screen.getByText("Open me"));
    expect(calls).toContainEqual({ cmd: "mark_seen", args: { queueId: "review", prId: one.pr.id } });
    expect(calls.find((c) => c.cmd === "open_review")?.args).toMatchObject({
      id: one.pr.id,
      teams: ["acme/web-team"],
      queue: "review",
    });
  });

  it("marks the whole queue read", async () => {
    const { user, calls } = await setup(live({ items: { review: [item("review", "New one")] } }));
    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(calls).toContainEqual({ cmd: "mark_queue_seen", args: { queueId: "review" } });
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });

  it("picks rows to mark done, and puts them back with Undo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const a = item("review", "First");
    const b = item("review", "Second");
    const { calls } = await setup(live({ items: { review: [a, b] }, seen: seenAll(a, b) }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Second" }));
    expect(within(footer()).getByRole("status").textContent).toBe("2 selected");

    await user.click(screen.getByRole("button", { name: "Mark Done" }));
    expect(calls).toContainEqual({ cmd: "dismiss", args: { queueId: "review", prId: a.pr.id } });
    expect(calls).toContainEqual({ cmd: "dismiss", args: { queueId: "review", prId: b.pr.id } });
    expect(screen.queryByText("First")).toBeNull();
    expect(within(footer()).getByRole("status").textContent).toBe("2 marked done");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(calls).toContainEqual({ cmd: "restore", args: { queueId: "review", prId: a.pr.id } });
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("stops offering Undo after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const a = item("review", "First");
    await setup(live({ items: { review: [a, item("review", "Second")] } }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await user.click(screen.getByRole("button", { name: "Mark Done" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("clears what's picked with Clear, and when switching queues", async () => {
    const { user } = await setup(live({ items: { review: [item("review", "First")] } }));
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await user.click(screen.getByRole("tab", { name: /Involved/u }));
    await user.click(screen.getByRole("tab", { name: /Review/u }));
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
  });

  it("forgets a pick whose pull request has left the queue", async () => {
    const a = item("review", "First");
    const b = item("review", "Second");
    const { user } = await setup(live({ items: { review: [a, b] } }));
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await snapshot(live({ items: { review: [b] } }));
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
  });

  it("picks a run of rows with shift-click, and shows the run ahead while Shift is down", async () => {
    const rows = ["One", "Two", "Three", "Four"].map((t) => item("review", t));
    const { user } = await setup(live({ items: { review: rows }, seen: seenAll(...rows) }));
    const order = within(screen.getByRole("region", { name: "acme/web" }))
      .getAllByRole("checkbox")
      .map((c) => c.getAttribute("aria-label"));
    const first = order[0]!.replace("Select ", "");
    const third = order[2]!.replace("Select ", "");
    await user.click(screen.getByRole("checkbox", { name: `Select ${first}` }));

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    const thirdRow = screen.getByRole("checkbox", { name: `Select ${third}` }).parentElement!;
    fireEvent.pointerEnter(thirdRow);
    const pending = document.querySelectorAll("[data-pending]");
    expect(pending).toHaveLength(3);

    fireEvent.click(thirdRow.querySelector("div[aria-hidden]")!, { shiftKey: true });
    expect(within(footer()).getByRole("status").textContent).toBe("3 selected");

    fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
    expect(document.querySelectorAll("[data-pending]")).toHaveLength(0);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    fireEvent.blur(window);
    expect(document.querySelectorAll("[data-pending]")).toHaveLength(0);

    fireEvent.click(thirdRow.querySelector("div[aria-hidden]")!, { shiftKey: true });
    fireEvent.click(
      screen.getByRole("checkbox", { name: `Select ${first}` }).parentElement!.querySelector("div[aria-hidden]")!,
      {
        shiftKey: true,
      },
    );
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
  });

  it("picks just the one row on shift-click when the last one picked is no longer shown", async () => {
    const draft = item("review", "Draft", "acme/web", {}, { isDraft: true });
    const ready = item("review", "Ready");
    const { user } = await setup(live({ items: { review: [ready, draft] } }));
    const drafts = screen.getByRole("button", { name: /Drafts/u });
    await user.click(drafts);
    await user.click(screen.getByRole("checkbox", { name: "Select Draft" }));
    await user.click(drafts);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    const row = screen.getByRole("checkbox", { name: "Select Ready" }).parentElement!;
    fireEvent.pointerEnter(row);
    expect(document.querySelectorAll("[data-pending]")).toHaveLength(0);
    fireEvent.click(row.querySelector("div[aria-hidden]")!, { shiftKey: true });
    expect(within(footer()).getByRole("status").textContent).toBe("2 selected");
  });

  it("lets go of what's picked on Esc, then closes the panel", async () => {
    const { user, cmds } = await setup(live({ items: { review: [item("review", "First")] } }));
    await user.click(screen.getByRole("checkbox", { name: "Select First" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
    expect(cmds()).not.toContain("hide_panel");
    await user.keyboard("{Escape}");
    expect(cmds()).toContain("hide_panel");
  });

  it("leaves Esc to an open menu", async () => {
    const { user, cmds } = await setup(live());
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await screen.findByRole("menuitem", { name: /Settings/u });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cmds()).not.toContain("hide_panel");
  });

  it("answers ⌘, with Settings and ⌘Q with Quit", async () => {
    const { cmds } = await setup(live());
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    expect(cmds()).toContain("open_settings");
    fireEvent.keyDown(window, { key: "q", metaKey: true });
    expect(cmds()).toContain("quit");
  });

  it("opens Settings and quits from the menu", async () => {
    const { user, cmds } = await setup(live());
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Settings/u }));
    expect(cmds()).toContain("open_settings");
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /Quit Focus Diff/u }));
    expect(cmds()).toContain("quit");
  });

  it("picks the focused row with x", async () => {
    const { user } = await setup(live({ items: { review: [item("review", "First")] } }));
    screen.getByText("First").closest("button")!.focus();
    await user.keyboard("x");
    expect(within(footer()).getByRole("status").textContent).toBe("1 selected");
    fireEvent.keyDown(document.activeElement!, { key: "x", metaKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "x", ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "x", altKey: true });
    fireEvent.keyDown(document.body, { key: "x" });
    expect(within(footer()).getByRole("status").textContent).toBe("1 selected");
  });

  it("walks the rows with the arrow keys, Home and End", async () => {
    const rows = ["One", "Two", "Three"].map((t) => item("review", t));
    await setup(live({ items: { review: rows }, seen: seenAll(...rows) }));
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-row]")];
    const scroll = vi.fn<() => void>();
    for (const b of buttons) b.scrollIntoView = scroll;

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
    expect(scroll).toHaveBeenCalled();

    buttons[1]!.blur();
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("leaves the arrow keys to fields, the queue tabs and the repository chips", async () => {
    const rows = [item("review", "One"), item("review", "Two", "acme/api")];
    await setup(live({ items: { review: rows } }));
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(document.activeElement).toBe(field);
    field.remove();

    const chip = screen.getByRole("button", { name: /^All/u });
    chip.focus();
    fireEvent.keyDown(chip, { key: "ArrowDown" });
    expect(document.activeElement).toBe(chip);
    fireEvent.keyDown(chip, { key: "End" });
    expect(document.activeElement?.hasAttribute("data-row")).toBe(true);

    const tab = screen.getByRole("tab", { name: /Review/u });
    tab.focus();
    fireEvent.keyDown(tab, { key: "Home" });
    expect(document.activeElement).toBe(tab);
  });

  it("does nothing with the arrow keys when there are no rows, a menu is open, or it's taken", async () => {
    const { user } = await setup(live());
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(document.querySelector("[data-row]")).toBeNull();

    await snapshot(live({ items: { review: [item("review", "One")] } }));
    const taken = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    taken.preventDefault();
    window.dispatchEvent(taken);
    expect(document.activeElement?.hasAttribute("data-row")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Menu" }));
    await screen.findByRole("menuitem", { name: /Settings/u });
    const before = document.activeElement;
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(before);
  });

  it("ignores keys sent to the window itself", async () => {
    const { cmds } = await setup(live({ items: { review: [item("review", "One")] } }));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "x" });
    expect(document.activeElement?.hasAttribute("data-row")).toBe(false);
    expect(cmds()).not.toContain("hide_panel");
  });

  it("refreshes on demand, and shows when it's at it", async () => {
    const { user, calls } = await setup(live());
    expect(within(footer()).getByRole("status").textContent).toBe("Updated just now");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(calls).toContainEqual({ cmd: "refresh", args: { force: true } });

    await snapshot(live({ status: { phase: "loading", updatedAt: 0 } }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Refresh" }).disabled).toBe(true);
    expect(within(footer()).getByRole("status").textContent).toBe("Checking GitHub…");

    await snapshot(live({ status: { phase: "idle", updatedAt: Date.now() - 5 * 60_000 } }));
    expect(within(footer()).getByRole("status").textContent).toBe("Updated 5m ago");

    await snapshot(live({ status: { phase: "idle", updatedAt: 0 } }));
    expect(within(footer()).getByRole("status").textContent).toBe("");
  });

  it("keeps the queues as they are while only the refresh changes", async () => {
    const items = { review: [item("review", "Steady", "acme/web", { viaTeams: undefined })] };
    const { user, calls } = await setup(live({ items }));
    await snapshot(live({ items, status: { phase: "loading", updatedAt: 0 } }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Refresh" }).disabled).toBe(true);
    expect(screen.getByText("Steady")).toBeTruthy();
    await user.click(screen.getByText("Steady"));
    expect(calls.find((c) => c.cmd === "open_review")?.args).toMatchObject({ teams: [] });
  });

  it("says when a refresh failed, and tries again on a click", async () => {
    const { user, calls } = await setup(live({ status: { phase: "error", error: "Bad credentials", updatedAt: 0 } }));
    await user.click(screen.getByRole("button", { name: "Couldn't refresh: Bad credentials. Try again" }));
    expect(calls).toContainEqual({ cmd: "refresh", args: { force: true } });
    await snapshot(live({ status: { phase: "error", updatedAt: 0 } }));
    expect(screen.getByRole("button", { name: "Couldn't refresh: . Try again" })).toBeTruthy();
  });

  it("offers an update, and installs it", async () => {
    const { user, cmds } = await setup(live(), { update: "2.0.0" });
    const button = await screen.findByRole("button", { name: "Update to 2.0.0 and restart" });
    expect(within(footer()).getByRole("status").className).toContain("sr-only");
    await user.click(button);
    expect(cmds()).toContain("install_update");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Updating…" }).disabled).toBe(true);
  });

  it("says what's new once after an update, and not on a first install", async () => {
    localStorage.setItem("seen-version", "1.0.0");
    const { user, view } = await setup(live(), { version: "1.1.0" });
    await user.click(await screen.findByRole("button", { name: "What's new in 1.1.0" }));
    const dialog = await screen.findByRole("dialog", { name: "What's new in Focus Diff 1.1.0" });
    expect(within(dialog).getByRole("heading", { name: /^1\.1\.0/u })).toBeTruthy();
    expect(within(dialog).queryByRole("heading", { name: /^1\.0\.0/u })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "What's new in 1.1.0" })).toBeNull();
    expect(localStorage.getItem("seen-version")).toBe("1.1.0");
    view.unmount();

    localStorage.clear();
    await setup(live(), { version: "1.1.0" });
    expect(localStorage.getItem("seen-version")).toBe("1.1.0");
    expect(screen.queryByRole("button", { name: /What's new/u })).toBeNull();
  });

  it("offers the update again when installing fails", async () => {
    const { user } = await setup(live(), { update: "2.0.0", failInstall: true });
    await user.click(await screen.findByRole("button", { name: "Update to 2.0.0 and restart" }));
    expect(await screen.findByRole("button", { name: "Update to 2.0.0 and restart" })).toBeTruthy();
  });

  it("offers an update found while it's open", async () => {
    await setup(live());
    await act(async () => {
      await emit("update-available", "3.1.0");
    });
    expect(screen.getByRole("button", { name: "Update to 3.1.0 and restart" })).toBeTruthy();
  });

  it("shows the review time under way", async () => {
    const run: ReviewRun = {
      run: { session: "s", name: "Morning reviews", minutes: 30, startedAt: 0, pulls: [], left: 0, overBy: 0 },
      endsAt: Date.now() + 10 * 60_000,
    };
    await setup(live({ review: run }));
    expect(screen.getByRole("region", { name: "Morning reviews" })).toBeTruthy();
  });

  it("plays what just arrived while the panel shows, then lets it go", async () => {
    const one = item("review", "Just in");
    const { calls } = await setup(live({ items: { review: [one] }, arrivals: [one.pr.id] }));
    const row = screen.getByRole("checkbox", { name: "Select Just in" }).parentElement!;
    expect(row.classList.contains("arrive")).toBe(true);
    fireEvent.animationEnd(row);
    expect(calls).toContainEqual({ cmd: "clear_arrival", args: { prId: one.pr.id } });
  });

  it("holds arrivals while the panel is hidden, and plays them once it shows", async () => {
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const one = item("review", "Just in");
    await setup(live({ items: { review: [one] }, arrivals: [one.pr.id] }));
    const row = screen.getByRole("checkbox", { name: "Select Just in" }).parentElement!;
    expect(row.classList.contains("arrive")).toBe(false);

    hidden.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(row.classList.contains("arrive")).toBe(true);
  });

  it("counts as shown when the app says the panel is up", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const one = item("review", "Just in");
    const { cmds } = await setup(live({ items: { review: [one] }, arrivals: [one.pr.id] }));
    await act(async () => {
      await emit("panel-shown");
    });
    expect(screen.getByRole("checkbox", { name: "Select Just in" }).parentElement!.classList.contains("arrive")).toBe(
      true,
    );
    expect(cmds()).toContain("refresh");
  });

  it("moves the keyboard into the list when it opens", async () => {
    await setup(live({ items: { review: [item("review", "One")] } }));
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Review pull requests");
    });
  });

  it("fetches the top of the list ahead, a moment after it opens", async () => {
    vi.useFakeTimers();
    const one = item("review", "One");
    const { calls } = await setup(live({ items: { review: [one] } }));
    expect(fetchedAhead(calls, one)).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchedAhead(calls, one)).toBe(true);
  });

  it("doesn't fetch ahead for a list that went before the moment was up", async () => {
    vi.useFakeTimers();
    const one = item("review", "One");
    const { view, calls } = await setup(live({ items: { review: [one] } }));
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchedAhead(calls, one)).toBe(false);
  });

  it("follows the snapshots and the language as they change", async () => {
    const one = item("review", "One");
    const two = item("review", "Two", "acme/api", {}, { isDraft: true });
    await setup(live({ items: { review: [one] } }), { strict: true });
    await snapshot(live({ items: { review: [one, two] } }));
    expect(screen.getByRole("button", { name: /Drafts/u })).toBeTruthy();
    try {
      act(() => {
        setLanguage("pt-BR");
      });
      expect(screen.getByRole("tablist").getAttribute("aria-label")).not.toBe("Queues");
    } finally {
      act(() => {
        setLanguage("en");
      });
    }
    await snapshot(live({ items: { review: [one, two] }, seen: seenAll(one, two) }));
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });
});
