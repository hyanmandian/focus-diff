import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { PullRow } from "@/components/pull-row/pull-row";
import { TEMPLATES, type Queue, type QueueKind } from "@/utils/config/config";
import type { Event, Item, PullRequest } from "@/utils/engine/engine";

const HOUR = 3_600_000;
let serial = 0;

function pr(over: Partial<PullRequest> = {}): PullRequest {
  serial += 1;
  return {
    id: `PR_${serial}`,
    number: 100 + serial,
    title: "Keep the promo code when the cart changes",
    url: `https://github.com/acme/web/pull/${100 + serial}`,
    isDraft: false,
    state: "OPEN",
    createdAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    updatedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    mergedAt: null,
    headRefOid: "abc",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    repository: { nameWithOwner: "acme/web" },
    author: { login: "ana", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    comments: 0,
    ...over,
  };
}

const event = (kind: Event["kind"], at = Date.now() - HOUR): Event => ({ key: `${kind}:${at}`, kind, at, who: null });

function item(over: Partial<Item> = {}, pull: Partial<PullRequest> = {}): Item {
  return { queueId: "q", pr: pr(pull), events: [], ci: null, ...over };
}

const queue = (kind: QueueKind, over: Partial<Queue> = {}): Queue => ({ ...TEMPLATES[kind].make(), id: "q", ...over });

type Props = Parameters<typeof PullRow>[0];

function setup(props: Partial<Props> & { item: Item }) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    // Nothing on disk, and every other command just done.
    return null;
  });
  const handlers = {
    onOpen: vi.fn<Props["onOpen"]>(),
    onDismiss: vi.fn<Props["onDismiss"]>(),
    onArrived: vi.fn<Props["onArrived"]>(),
    onPick: vi.fn<Props["onPick"]>(),
    onHover: vi.fn<NonNullable<Props["onHover"]>>(),
  };
  const view = render(
    <PullRow
      queue={queue("review")}
      unread={false}
      arriving={false}
      picked={false}
      selecting={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, calls, view, user: userEvent.setup() };
}

describe("PullRow", () => {
  it("shows the title, number, author, when it changed and how much talk", () => {
    const one = item({}, { comments: 3 });
    setup({ item: one });
    expect(screen.getByText(one.pr.title)).toBeTruthy();
    expect(screen.getByText(`#${one.pr.number}`)).toBeTruthy();
    expect(screen.getByText("ana")).toBeTruthy();
    expect(screen.getByText("2h")).toBeTruthy();
    expect(screen.getByLabelText("3 comments")).toBeTruthy();
    expect(document.querySelector("img")?.getAttribute("src")).toContain("/u/1");
  });

  it("marks an unread row with a dot and a word for screen readers", () => {
    setup({ item: item(), unread: true });
    expect(document.querySelector("[data-dot]")).toBeTruthy();
    expect(screen.getByText("Unread:")).toBeTruthy();
  });

  it("shows the author's initial without a picture, and a question mark without an author", () => {
    const { view } = setup({ item: item({}, { author: { login: "bo" } }) });
    expect(screen.getByText("B")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    view.unmount();
    setup({ item: item({}, { author: null }) });
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("shows a pull request icon instead of the author on your own queue", () => {
    setup({ item: item(), queue: queue("authored") });
    expect(screen.queryByText("ana")).toBeNull();
    expect(screen.queryByText("A")).toBeNull();
  });

  it("estimates the review on the review queue, without the tilde in its tooltip", () => {
    setup({ item: item({}, { changedFiles: 4, additions: 500, deletions: 0 }) });
    const estimate = screen.getByTitle(/^About .* to review, at your pace$/u);
    expect(estimate.textContent).toContain("min");
    expect(estimate.getAttribute("title")).not.toContain("~");
  });

  it("calls out a pull request waiting on you longer than the queue allows", () => {
    setup({ item: item({ waitingSince: Date.now() - 30 * HOUR }), queue: queue("review", { staleHours: 24 }) });
    expect(screen.getByText("waiting 1d")).toBeTruthy();
    expect(screen.getByTitle("Waiting on you for 1d")).toBeTruthy();
  });

  it("doesn't call out waiting when the queue has no limit or it isn't long yet", () => {
    const { view } = setup({
      item: item({ waitingSince: Date.now() - 30 * HOUR }),
      queue: queue("review", { staleHours: 0 }),
    });
    expect(screen.queryByText(/^waiting/u)).toBeNull();
    view.unmount();
    setup({ item: item({ waitingSince: Date.now() - HOUR }), queue: queue("review", { staleHours: 24 }) });
    expect(screen.queryByText(/^waiting/u)).toBeNull();
  });

  it("says who merged it, by first name, and dates it by the merge on the merged queue", () => {
    setup({
      item: item(
        {},
        {
          mergedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          mergedBy: { login: "carla", name: "Carla Dias" },
        },
      ),
      queue: queue("merged"),
    });
    expect(screen.getByText("merged by Carla")).toBeTruthy();
    expect(screen.getByText("5m")).toBeTruthy();
  });

  it("dates a merged one without a merge time by its last update", () => {
    setup({ item: item(), queue: queue("merged") });
    expect(screen.getByText("2h")).toBeTruthy();
    expect(screen.queryByText(/^merged by/u)).toBeNull();
  });

  it("tags the two most direct things that happened, latest first by time", () => {
    setup({
      item: item({
        events: [
          event("new"),
          event("comment", Date.now() - 10 * 60_000),
          event("approved"),
          event("rerequest"),
          event("comment"),
        ],
      }),
    });
    expect(screen.getByText("Re-review")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByText("Comment")).toBeNull();
    expect(screen.getByTitle("Your review was requested again")).toBeTruthy();
    expect(screen.getByText("10m")).toBeTruthy();
  });

  it("shows where you stand when nothing new happened, but not a mention", () => {
    const { view } = setup({ item: item({ status: "APPROVED" }) });
    expect(screen.getByTitle("You approved").textContent).toContain("Approved");
    view.unmount();
    setup({ item: item({ status: "MENTIONED" }) });
    expect(screen.queryByText("Mention")).toBeNull();
  });

  it("leaves out where you stand once something new happened", () => {
    setup({ item: item({ status: "APPROVED", events: [event("commits")] }) });
    expect(screen.getByText("Commits")).toBeTruthy();
    expect(screen.queryByTitle("You approved")).toBeNull();
  });

  it("calls out failing CI unless it's already a tag", () => {
    const { view } = setup({ item: item({ ci: "ERROR" }) });
    expect(screen.getByText("CI failed")).toBeTruthy();
    view.unmount();
    setup({ item: item({ ci: "FAILURE", events: [event("ci-failed")] }) });
    expect(screen.getAllByText("CI failed")).toHaveLength(1);
  });

  it("names the team the review was asked of, and how many more", () => {
    const { view } = setup({ item: item({ viaTeams: ["acme/web-team", "acme/payments"] }) });
    expect(screen.getByText("via web-team +1")).toBeTruthy();
    expect(screen.getByTitle("Asked of acme/web-team and acme/payments")).toBeTruthy();
    view.unmount();
    setup({ item: item({ viaTeams: ["acme/web-team"] }) });
    expect(screen.getByText("via web-team")).toBeTruthy();
  });

  it("doesn't name teams once something new happened", () => {
    setup({ item: item({ viaTeams: ["acme/web-team"], events: [event("reply")] }) });
    expect(screen.queryByText(/^via/u)).toBeNull();
  });

  it("opens the pull request from where its row is", async () => {
    const one = item();
    const { user, onOpen } = setup({ item: one });
    await user.click(screen.getByText(one.pr.title));
    expect(onOpen.mock.calls[0]?.[0]).toBe(one);
    expect(onOpen.mock.calls[0]?.[1]).toBeInstanceOf(DOMRect);
  });

  it("picks the row with its box, and a run of rows with shift", async () => {
    const one = item();
    const { user, onPick, view } = setup({ item: one });
    const box = view.container.querySelector<HTMLElement>("[aria-hidden].absolute")!;
    await user.click(box);
    expect(onPick).toHaveBeenLastCalledWith(one, true, false);
    fireEvent.click(box, { shiftKey: true });
    expect(onPick).toHaveBeenLastCalledWith(one, true, true);
  });

  it("keeps shift-clicking from selecting text, and leaves plain clicks alone", () => {
    const { view } = setup({ item: item() });
    const box = view.container.querySelector<HTMLElement>("[aria-hidden].absolute")!;
    expect(fireEvent.mouseDown(box, { shiftKey: true })).toBe(false);
    expect(fireEvent.mouseDown(box)).toBe(true);
  });

  it("lets go of a picked row with its checkbox", () => {
    const one = item();
    const { onPick } = setup({ item: one, picked: true });
    const box = screen.getByRole<HTMLInputElement>("checkbox", { name: `Select ${one.pr.title}` });
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onPick).toHaveBeenCalledWith(one, false);
  });

  it("marks the row as picked, pending and selecting for its styles", () => {
    const { view } = setup({ item: item(), picked: true, pending: true, selecting: true });
    const el = view.container.firstElementChild!;
    expect(el.hasAttribute("data-picked")).toBe(true);
    expect(el.hasAttribute("data-pending")).toBe(true);
    expect(el.hasAttribute("data-selecting")).toBe(true);
  });

  it("says which row is under the pointer", () => {
    const one = item();
    const { onHover, view } = setup({ item: one });
    const el = view.container.firstElementChild!;
    fireEvent.pointerEnter(el);
    expect(onHover).toHaveBeenLastCalledWith(one.pr.id);
    fireEvent.pointerLeave(el);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it("works without a hover handler", () => {
    const one = item();
    const view = render(
      <PullRow
        item={one}
        queue={queue("review")}
        unread={false}
        arriving={false}
        picked={false}
        selecting={false}
        onOpen={() => {}}
        onDismiss={() => {}}
        onArrived={() => {}}
        onPick={() => {}}
      />,
    );
    const el = view.container.firstElementChild!;
    fireEvent.pointerEnter(el);
    fireEvent.pointerLeave(el);
    expect(el.hasAttribute("data-pending")).toBe(false);
  });

  it("fetches the pull request ahead when the pointer rests on it, not when it passes", async () => {
    vi.useFakeTimers();
    try {
      const one = item();
      const { calls } = setup({ item: one });
      const el = screen.getByText(one.pr.title).closest("button")!;
      fireEvent.pointerEnter(el);
      fireEvent.pointerLeave(el);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(calls.some((c) => c.cmd === "github")).toBe(false);
      fireEvent.pointerEnter(el);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(calls.some((c) => c.cmd === "github")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches the pull request ahead when the keyboard lands on it", async () => {
    const one = item();
    const { calls } = setup({ item: one });
    fireEvent.focus(screen.getByText(one.pr.title).closest("button")!);
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "github")).toBe(true);
    });
  });

  it("plays the arrival once, then says it arrived", () => {
    const one = item();
    const { onArrived, view } = setup({ item: one, arriving: true });
    const el = view.container.firstElementChild!;
    expect(el.classList.contains("arrive")).toBe(true);
    fireEvent.animationEnd(el);
    expect(el.classList.contains("arrive")).toBe(false);
    expect(onArrived).toHaveBeenCalledWith(one.pr.id);
  });

  it("stops waiting for the arrival when the row goes", () => {
    const one = item();
    const { onArrived, view } = setup({ item: one, arriving: true });
    const el = view.container.firstElementChild!;
    view.unmount();
    fireEvent.animationEnd(el);
    expect(onArrived).not.toHaveBeenCalled();
  });

  it("opens the pull request on GitHub from its menu", async () => {
    const one = item();
    const { user, calls } = setup({ item: one });
    await user.click(screen.getByRole("button", { name: `More for ${one.pr.title}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Open on GitHub" }));
    expect(calls).toContainEqual({ cmd: "open_url", args: { url: one.pr.url } });
  });

  it("ignores a pull request from its menu, or marks a merged one seen", async () => {
    const one = item();
    const { user, onDismiss, view } = setup({ item: one });
    await user.click(screen.getByRole("button", { name: `More for ${one.pr.title}` }));
    await user.click(await screen.findByRole("menuitem", { name: "Ignore" }));
    expect(onDismiss).toHaveBeenCalledWith(one);
    view.unmount();

    const merged = item();
    const second = setup({ item: merged, queue: queue("merged") });
    await second.user.click(screen.getByRole("button", { name: `More for ${merged.pr.title}` }));
    await second.user.click(await screen.findByRole("menuitem", { name: "Mark as Seen" }));
    expect(second.onDismiss).toHaveBeenCalledWith(merged);
  });

  it("greys out a draft's title", () => {
    const one = item({}, { isDraft: true });
    setup({ item: one });
    expect(screen.getByText(one.pr.title).className).toContain("text-muted-foreground");
  });
});
