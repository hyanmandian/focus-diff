import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Item } from "../../utils/engine/engine";
import { mockCommands } from "../../utils/fake-platform/fake-platform";
import { setLanguage } from "../../utils/i18n/i18n";
import type { ReviewRun, RunPull } from "../../utils/store/store";
import { ReviewTime } from "./panel-review-time";

const pull = (over: Partial<RunPull> = {}): RunPull => ({
  id: "PR_1",
  title: "Keep the promo code when the cart changes",
  repo: "acme/web",
  number: 1802,
  url: "https://github.com/acme/web/pull/1802",
  minutes: 12,
  again: false,
  ...over,
});

function review(endsAt: number, pulls: RunPull[]): ReviewRun {
  return {
    run: { session: "s", name: "Morning reviews", minutes: 30, startedAt: 0, pulls, left: 0, overBy: 0 },
    endsAt,
  };
}

/** The pull request as the review queue has it. */
const queued: Item = {
  queueId: "review",
  pr: {
    id: "PR_1",
    number: 1802,
    title: "Keep the promo code when the cart changes",
    url: "https://github.com/acme/web/pull/1802",
    isDraft: false,
    state: "OPEN",
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    mergedAt: null,
    headRefOid: "abc",
    additions: 40,
    deletions: 3,
    changedFiles: 2,
    repository: { nameWithOwner: "acme/web" },
    author: { login: "ana", name: "Ana Souza" },
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    comments: 0,
  },
  events: [{ key: "review:PR_1:new", kind: "new", at: 0, who: null }],
  viaTeams: ["acme/web-team"],
  ci: null,
};

function setup(run: ReviewRun, items: Record<string, Item[]> = {}) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    return null;
  });
  const view = render(<ReviewTime review={run} items={items} />);
  return { calls, view, user: userEvent.setup() };
}

describe("ReviewTime", () => {
  it("shows the review time, the minutes left rounded up, and its pull requests", () => {
    setup(
      review(Date.now() + 14.5 * 60_000, [pull(), pull({ id: "PR_2", title: "Fix totals", again: true, minutes: 5 })]),
    );
    expect(screen.getByRole("region", { name: "Morning reviews" })).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("15 min left");
    expect(screen.getByText("Keep the promo code when the cart changes")).toBeTruthy();
    expect(screen.getByText("~12 min")).toBeTruthy();
    expect(screen.getAllByText("Re-review")).toHaveLength(1);
  });

  it("never counts below zero once the time is up", () => {
    setup(review(Date.now() - 60_000, []));
    expect(screen.getByRole("timer").textContent).toBe("0 min left");
  });

  it("counts down as time passes", () => {
    vi.useFakeTimers();
    try {
      setup(review(Date.now() + 10 * 60_000, []));
      expect(screen.getByRole("timer").textContent).toBe("10 min left");
      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      expect(screen.getByRole("timer").textContent).toBe("8 min left");
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows the review time as it changes, and stays put while it doesn't", () => {
    vi.useFakeTimers();
    try {
      const endsAt = Date.now() + 10 * 60_000;
      const { view } = setup(review(endsAt, [pull()]));
      // A tick inside the same minute.
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.getByRole("timer").textContent).toBe("10 min left");
      view.rerender(<ReviewTime review={review(endsAt, [pull()])} items={{}} />);
      expect(screen.getByText("Keep the promo code when the cart changes")).toBeTruthy();
      const later = review(endsAt + 20 * 60_000, [pull({ id: "PR_3", title: "Speed up search" })]);
      later.run.name = "Afternoon reviews";
      view.rerender(<ReviewTime review={later} items={{}} />);
      expect(screen.getByRole("region", { name: "Afternoon reviews" })).toBeTruthy();
      expect(screen.getByRole("timer").textContent).toBe("30 min left");
      expect(screen.getByText("Speed up search")).toBeTruthy();
      expect(screen.queryByText("Keep the promo code when the cart changes")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps what it shows when only the queues change", () => {
    const run = review(Date.now() + 5 * 60_000, [pull()]);
    const { view } = setup(run);
    view.rerender(<ReviewTime review={run} items={{ review: [queued] }} />);
    expect(screen.getByRole("timer").textContent).toBe("5 min left");
    expect(screen.getByText("Keep the promo code when the cart changes")).toBeTruthy();
  });

  it("shows a pull request added to the review time", () => {
    const items = {};
    const endsAt = Date.now() + 5 * 60_000;
    const { view } = setup(review(endsAt, [pull()]), items);
    view.rerender(
      <ReviewTime review={review(endsAt, [pull(), pull({ id: "PR_4", title: "Tidy up" })])} items={items} />,
    );
    expect(screen.getByText("Tidy up")).toBeTruthy();
  });

  it("speaks the language picked, as soon as it's picked", () => {
    setup(review(Date.now() + 5 * 60_000, []));
    try {
      act(() => {
        setLanguage("pt-BR");
      });
      expect(screen.getByRole("button", { name: "Encerrar" })).toBeTruthy();
      expect(screen.getByRole("timer").textContent).toBe("faltam 5 min");
    } finally {
      act(() => {
        setLanguage("en");
      });
    }
  });

  it("ends the review time early", async () => {
    const { user, calls } = setup(review(Date.now() + 60_000, []));
    await user.click(screen.getByRole("button", { name: "End" }));
    expect(calls.map((c) => c.cmd)).toContain("end_review");
  });

  it("opens a pull request from its queue, counting the click as a look", async () => {
    const { user, calls } = setup(review(Date.now() + 60_000, [pull()]), { review: [queued] });
    await user.click(screen.getByRole("button", { name: /Keep the promo code/u }));
    expect(calls).toContainEqual({ cmd: "mark_seen", args: { queueId: "review", prId: "PR_1" } });
    expect(calls.find((c) => c.cmd === "open_review")?.args).toMatchObject({
      id: "PR_1",
      repo: "acme/web",
      number: 1802,
      teams: ["acme/web-team"],
      queue: "review",
      title: "#1802 · Keep the promo code when the cart changes · Ana",
    });
  });

  it("opens a pull request that's no longer on a queue from what the review time knows", async () => {
    const { user, calls } = setup(review(Date.now() + 60_000, [pull({ id: "PR_9", number: 9, title: "Gone" })]));
    await user.click(screen.getByRole("button", { name: /Gone/u }));
    expect(calls.map((c) => c.cmd)).not.toContain("mark_seen");
    expect(calls.find((c) => c.cmd === "open_review")?.args).toMatchObject({
      id: "PR_9",
      repo: "acme/web",
      number: 9,
      teams: [],
      queue: null,
      title: "#9 · Gone · ",
    });
  });
});
