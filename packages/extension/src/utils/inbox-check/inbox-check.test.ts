import { describe, expect, it, vi } from "vitest";

import { InboxError, type Activity, type Detail, type PullRequest } from "@/utils/github-inbox/github-inbox";
import { sampleActivity, sampleNotify, samplePull } from "@/utils/github-sample-pull/github-sample-pull";
import { DEFAULT_NOTIFY, type InboxMemory } from "@/utils/inbox/inbox";

import { checkInbox, type InboxSource } from "./inbox-check";

const pull = samplePull;

const activity = sampleActivity;

const on = sampleNotify;

interface SourceData {
  reviews?: PullRequest[];
  direct?: PullRequest[];
  activity?: Activity[];
  detail?: Detail;
}

const source = ({
  reviews = [],
  direct = [],
  activity: threads = [],
  detail = { actor: "grace", bot: false, review: null, myReview: null, excerpt: "" },
}: SourceData = {}): InboxSource => ({
  pulls: vi.fn<InboxSource["pulls"]>((list) =>
    Promise.resolve(list === "reviews" ? reviews : list === "direct" ? direct : []),
  ),
  notifications: vi.fn<InboxSource["notifications"]>(() => Promise.resolve({ me: "me-too", activity: threads })),
  detail: vi.fn<InboxSource["detail"]>(() => Promise.resolve(detail)),
});

const memory = (extra: Partial<InboxMemory> = {}): InboxMemory => ({ threads: {}, reviews: [], ...extra });

describe("checkInbox", () => {
  it("only reads the lists while notifications are off", async () => {
    const github = source({ reviews: [pull(1)] });
    const result = await checkInbox(github, { ...on({ "review-requested": [] }), enabled: false }, null);
    expect(result.snapshot).toMatchObject({ reviews: [pull(1)], mine: [], problem: null });
    expect(result.memory).toBeNull();
    expect(github.notifications).not.toHaveBeenCalled();
  });

  it("reads the lists the reader added to the popup, and leaves out one that fails without failing the look", async () => {
    const github = source({ reviews: [pull(1)] });
    vi.mocked(github.pulls).mockImplementation((list) =>
      list === "merged" ? Promise.reject(new InboxError("unreadable")) : Promise.resolve([pull(2)]),
    );
    const off = { ...on({}), enabled: false };
    const result = await checkInbox(github, off, null, { updates: true, merged: true });
    expect(result.snapshot).toMatchObject({ updates: [pull(2)], problem: null });
    expect(result.snapshot).not.toHaveProperty("merged");
    const without = await checkInbox(github, off, null);
    expect(without.snapshot).not.toHaveProperty("updates");
    expect(vi.mocked(github.pulls).mock.calls.map(([list]) => list)).toEqual([
      "reviews",
      "authored",
      "updates",
      "merged",
      "reviews",
      "authored",
    ]);
  });

  it("remembers where things stand on the first look, without telling", async () => {
    const result = await checkInbox(
      source({ reviews: [pull(1)], activity: [activity("a")] }),
      on({ "review-requested": [], "comment-mine": [] }),
      null,
    );
    expect(result.events).toEqual([]);
    expect(result.memory).toEqual({ threads: { a: "2026-10-09T10:00:00Z" }, reviews: [pull(1)] });
  });

  it("tells about a ready draft, unless the reader approved it already", async () => {
    const before = memory({ reviews: [pull(1, { draft: true })] });
    const ready = await checkInbox(source({ reviews: [pull(1)] }), on({ "ready-for-review": ["approved"] }), before);
    expect(ready.events).toMatchObject([{ kind: "ready-for-review", number: 1, approvedByMe: false }]);

    const approved = source({
      reviews: [pull(1)],
      detail: { actor: "", bot: false, review: null, myReview: "approved", excerpt: "" },
    });
    expect((await checkInbox(approved, on({ "ready-for-review": ["approved"] }), before)).events).toEqual([]);
  });

  it("tells who commented or reviewed, with the link, and leaves out bots and the reader", async () => {
    const before = memory({ threads: { a: "2026-10-08T00:00:00Z" } });
    const comment = await checkInbox(source({ activity: [activity("a")] }), on({ "comment-mine": ["bots"] }), before);
    expect(comment.events).toMatchObject([
      { kind: "comment-mine", actor: "grace", url: "https://github.com/octo/web/pull/12#issuecomment-1" },
    ]);

    const bot = source({
      activity: [activity("a")],
      detail: { actor: "ci", bot: true, review: null, myReview: null, excerpt: "" },
    });
    expect((await checkInbox(bot, on({ "comment-mine": ["bots"] }), before)).events).toEqual([]);

    const self = source({
      activity: [activity("a")],
      detail: { actor: "Me-Too", bot: false, review: null, myReview: null, excerpt: "" },
    });
    expect((await checkInbox(self, on({ "comment-mine": [] }), before)).events).toEqual([]);

    const review = activity("a", { kind: "review", anchor: "pullrequestreview-2" });
    const approval = source({
      activity: [review],
      detail: { actor: "grace", bot: false, review: "approved", myReview: null, excerpt: "" },
    });
    expect((await checkInbox(approval, on({ approved: [] }), before)).events).toMatchObject([
      { kind: "approved", actor: "grace" },
    ]);
  });

  it("says what a comment said", async () => {
    const before = memory({ threads: { a: "2026-10-08T00:00:00Z" } });
    const said = source({
      activity: [activity("a")],
      detail: { actor: "grace", bot: false, review: null, myReview: null, excerpt: "Could this cache expire?" },
    });
    expect((await checkInbox(said, on({ "comment-mine": [] }), before)).events).toMatchObject([
      { excerpt: "Could this cache expire?" },
    ]);
  });

  it("tells the reviews asked of a team from the ones asked of the reader, and leaves the team’s out with the queue", async () => {
    const before = memory({ reviews: [], threads: { a: "2026-10-08T00:00:00Z", b: "2026-10-08T00:00:00Z" } });
    const threads = [
      activity("a", { reason: "review_requested", number: 1, anchor: "issuecomment-1" }),
      activity("b", { reason: "author", number: 3, anchor: "issuecomment-3" }),
    ];
    const github = source({ reviews: [pull(1), pull(2)], direct: [pull(2)], activity: threads });
    const settings = on({ "review-requested": [], "comment-reviewing": [], "comment-mine": [] });
    const told = await checkInbox(github, settings, before);
    expect(told.events.map(({ kind, number, team }) => [kind, number, team])).toEqual([
      ["review-requested", 1, true],
      ["review-requested", 2, false],
      ["comment-reviewing", 1, true],
      ["comment-mine", 3, false],
    ]);
    // Left out of the queue, a team's review isn't told about, nor what's said on it; the reader's own pull requests are.
    const skipped = await checkInbox(github, settings, before, { skipTeams: true });
    expect(skipped.events.map(({ kind, number }) => [kind, number])).toEqual([
      ["review-requested", 2],
      ["comment-mine", 3],
    ]);
  });

  it("reads the list of reviews asked of the reader only when it tells something", async () => {
    const quiet = source({ reviews: [pull(1)] });
    await checkInbox(quiet, on({ "review-requested": [] }), memory({ reviews: [pull(1)] }));
    expect(quiet.pulls).not.toHaveBeenCalledWith("direct");

    const queue = source({ reviews: [pull(1), pull(2)], direct: [pull(1)] });
    const result = await checkInbox(queue, { ...DEFAULT_NOTIFY }, null, { skipTeams: true });
    expect(result.snapshot.reviews.map(({ team }) => team)).toEqual([false, true]);

    // Unread, none is known to be a team's.
    queue.pulls = vi.fn<InboxSource["pulls"]>((list) =>
      list === "direct"
        ? Promise.reject(new InboxError("unreadable"))
        : Promise.resolve(list === "reviews" ? [pull(1)] : []),
    );
    const failed = await checkInbox(queue, { ...DEFAULT_NOTIFY }, null, { skipTeams: true });
    expect(failed.snapshot).toMatchObject({ reviews: [pull(1)], problem: null });
  });

  it("reads no pull request page for events the reader didn’t ask about", async () => {
    const github = source({ activity: [activity("a", { repo: "other/app" })] });
    await checkInbox(github, on({ "comment-mine": [] }, ["octo/*"]), memory());
    expect(github.detail).not.toHaveBeenCalled();
  });

  it("reads at most eight pull request pages a look, three at a time", async () => {
    const before = memory({
      threads: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`t${index}`, "2026-10-08T00:00:00Z"])),
    });
    const threads = Array.from({ length: 12 }, (_, index) =>
      activity(`t${index}`, { anchor: `issuecomment-${index}` }),
    );
    const github = source({ activity: threads });
    let open = 0;
    let most = 0;
    github.detail = vi.fn<InboxSource["detail"]>(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      open -= 1;
      return { actor: "grace", bot: false, review: null, myReview: null, excerpt: "" };
    });
    const result = await checkInbox(github, on({ "comment-mine": [] }), before);
    expect(github.detail).toHaveBeenCalledTimes(8);
    expect(most).toBe(3);
    expect(result.events.map((event) => event.url)).toHaveLength(8);
  });

  it("says what went wrong", async () => {
    const github = source();
    github.pulls = vi.fn<InboxSource["pulls"]>(() => Promise.reject(new InboxError("signed-out")));
    expect((await checkInbox(github, on({}), null)).snapshot.problem).toBe("signed-out");
  });

  it("takes anything else that went wrong as a page it couldn't read", async () => {
    const github = source();
    github.notifications = vi.fn<InboxSource["notifications"]>(() => Promise.reject(new Error("boom")));
    expect((await checkInbox(github, on({ mention: [] }), null)).snapshot).toMatchObject({
      me: "",
      reviews: [],
      problem: "unreadable",
    });
  });

  it("still tells a new request when the list of the ones asked by name can't be read, or its page can't", async () => {
    const github = source({ reviews: [pull(1), pull(2)] });
    github.pulls = vi.fn<InboxSource["pulls"]>((list) =>
      list === "direct"
        ? Promise.reject(new InboxError("offline"))
        : Promise.resolve(list === "reviews" ? [pull(1)] : []),
    );
    github.detail = vi.fn<InboxSource["detail"]>(() => Promise.reject(new InboxError("offline")));
    const result = await checkInbox(github, on({ "review-requested": ["approved"] }), memory());
    expect(result.events).toMatchObject([{ kind: "review-requested", number: 1, team: false, approvedByMe: false }]);
    expect(result.snapshot.reviews[0]?.team).toBeUndefined();
  });
});
