import { describe, expect, it } from "vitest";

import { parsePullRequest } from "../github-pulls/github-pulls";
import { isScheduled, parseConfig, type ReviewTime } from "../queue-config/queue-config";
import {
  candidate,
  due,
  endsAt,
  endWords,
  ENGLISH_REVIEW,
  estimateMinutes,
  localOffset,
  minutesLeft,
  offerWords,
  paceFactor,
  plan,
  PORTUGUESE_REVIEW,
  type Candidate,
  type Plan,
  type Run,
} from "./review-time";

// review.rs's tests, ported.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Monday 2026-01-05 00:00 UTC. */
const MONDAY = 1_767_571_200_000;

const settings = (sessions: unknown[], enabled = true): ReviewTime =>
  parseConfig({ reviewTime: { enabled, sessions } })!.reviewTime;

const utcZone = () => 0;

describe("when review time comes", () => {
  it("comes on its days, at its time, for a while", () => {
    const s = settings([{ id: "a", days: [1, 2, 3, 4, 5], times: ["15:00"], minutes: 30 }]);
    const at = MONDAY + 15 * HOUR;
    expect(due(s, at - MINUTE, at, utcZone)?.at).toBe(at);
    // Caught up later, while it lasts.
    expect(due(s, at - MINUTE, at + 29 * MINUTE, utcZone)?.at).toBe(at);
    expect(due(s, at - MINUTE, at + 30 * MINUTE, utcZone)).toBeNull();
    // Already looked at.
    expect(due(s, at, at + MINUTE, utcZone)).toBeNull();
    // Not yet.
    expect(due(s, at - MINUTE, at - 1, utcZone)).toBeNull();
    // A time that doesn't read (one not from parseConfig) is skipped.
    const odd = { ...s, sessions: [{ ...s.sessions[0]!, times: ["9:00", "15:00"] }] };
    expect(due(odd, at - MINUTE, at, utcZone)?.at).toBe(at);
    const sunday = at - DAY;
    expect(due(s, sunday - MINUTE, sunday, utcZone)).toBeNull();
    const off = settings([{ id: "a", on: false, days: [1], times: ["15:00"] }]);
    expect(due(off, at - MINUTE, at, utcZone)).toBeNull();
    const disabled = settings([{ id: "a", days: [1], times: ["15:00"] }], false);
    expect(due(disabled, at - MINUTE, at, utcZone)).toBeNull();
    expect(isScheduled(disabled)).toBe(false);
    expect(isScheduled(s)).toBe(true);
  });

  it("is in local time, the system's zone", () => {
    // São Paulo, three hours behind: 15:00 there is 18:00 UTC.
    const s = settings([{ id: "a", days: [1], times: ["15:00"], minutes: 30 }]);
    const saoPaulo = () => -3 * HOUR;
    expect(due(s, MONDAY + 15 * HOUR - MINUTE, MONDAY + 15 * HOUR, saoPaulo)).toBeNull();
    expect(due(s, MONDAY + 18 * HOUR - MINUTE, MONDAY + 18 * HOUR, saoPaulo)?.at).toBe(MONDAY + 18 * HOUR);
    // Tokyo, nine hours ahead: Monday 08:00 there is Sunday 23:00 UTC.
    const early = settings([{ id: "a", days: [1], times: ["08:00"], minutes: 30 }]);
    const at = MONDAY - HOUR;
    expect(due(early, at - MINUTE, at, () => 9 * HOUR)?.at).toBe(at);
    // The clock goes forward an hour at 02:00 UTC: 09:00 local is then 08:00 UTC, not 09:00.
    const summer = (t: number) => (t >= MONDAY + 2 * HOUR ? HOUR : 0);
    const nine = settings([{ id: "a", days: [1], times: ["09:00"], minutes: 30 }]);
    expect(due(nine, MONDAY, MONDAY + 8 * HOUR, summer)?.at).toBe(MONDAY + 8 * HOUR);
  });

  it("runs past midnight, and the later of two wins", () => {
    // Friday 23:50 for 30 minutes: still on at Saturday 00:10, though Saturday isn't one of its days.
    const s = settings([{ id: "late", days: [5], times: ["23:50"], minutes: 30 }]);
    const start = MONDAY + 4 * DAY + 23 * HOUR + 50 * MINUTE;
    expect(due(s, start - MINUTE, start + 20 * MINUTE, utcZone)?.session.id).toBe("late");
    expect(due(s, start - MINUTE, start + 30 * MINUTE, utcZone)).toBeNull();
    const two = settings([
      { id: "a", days: [1], times: ["15:00"], minutes: 60 },
      { id: "b", days: [1], times: ["15:30"], minutes: 30 },
    ]);
    const at = MONDAY + 15 * HOUR + 40 * MINUTE;
    expect(due(two, MONDAY, at, utcZone)?.session.id).toBe("b");
    // Written in the other order, still the later one.
    const reversed = settings([
      { id: "b", days: [1], times: ["15:30"], minutes: 30 },
      { id: "a", days: [1], times: ["15:00"], minutes: 60 },
    ]);
    expect(due(reversed, MONDAY, at, utcZone)?.session.id).toBe("b");
  });

  it("reads the system's zone from the clock by default", () => {
    expect(localOffset(MONDAY)).toBe(-new Date(MONDAY).getTimezoneOffset() * MINUTE);
    const s = settings([{ id: "a", days: [0, 1, 2, 3, 4, 5, 6], times: ["00:00"], minutes: 240 }]);
    const local = new Date(MONDAY);
    local.setHours(0, 0, 0, 0);
    expect(due(s, local.getTime() - MINUTE, local.getTime() + MINUTE)?.at).toBe(local.getTime());
  });
});

const make = (id: string, minutes: number, ageDays: number, again: boolean): Candidate => ({
  pull: { id, title: id, repo: "acme/web", number: 1, url: "", minutes: Math.round(minutes), again },
  minutes,
  created: MONDAY - ageDays * DAY,
});

const ids = (p: Plan) => p.picked.map((x) => x.id);

describe("how long a review takes", () => {
  it("goes by the changed lines", () => {
    const pr = { additions: 480, deletions: 100, changedFiles: 4 };
    // 500 weighted lines at 1,000 an hour, plus a minute for 4 files.
    expect(estimateMinutes(pr, 1)).toBe(31);
    expect(estimateMinutes(pr, 2)).toBe(62);
    expect(estimateMinutes({ additions: -1, deletions: -1, changedFiles: -1 }, 1)).toBe(0);
    expect(paceFactor(null)).toBe(1);
    expect(paceFactor({ all: { actual: 60, expected: 20 } })).toBe(2);
    expect(paceFactor({ all: { actual: -5, expected: "x" } })).toBe(1);
    expect(paceFactor({ all: null })).toBe(1);
  });

  it("makes a candidate of a pull request", () => {
    const pr = parsePullRequest({
      id: "PR_1",
      number: 7,
      title: "Fix login",
      url: "https://github.com/acme/web/pull/7",
      repository: { nameWithOwner: "acme/web" },
      createdAt: "2026-01-01T00:00:00Z",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    })!;
    const c = candidate(pr, true, 1);
    expect(c.pull).toStrictEqual({
      id: "PR_1",
      title: "Fix login",
      repo: "acme/web",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      minutes: 1,
      again: true,
    });
    expect(c.minutes).toBe(0);
    expect(c.created).toBe(Date.UTC(2026, 0, 1));
  });
});

describe("what fits", () => {
  const list = () => [
    make("big", 25, 1, false),
    make("old", 10, 9, false),
    make("mid", 12, 5, false),
    make("tiny", 3, 2, false),
  ];

  it("picks what fits, in the session's order", () => {
    const oldest = plan(list(), 30, "oldest", false);
    expect(ids(oldest)).toStrictEqual(["old", "mid", "tiny"]);
    expect([oldest.left, oldest.overBy]).toStrictEqual([1, 0]);
    expect(ids(plan(list(), 30, "quickest", false))).toStrictEqual(["tiny", "old", "mid"]);
    // The mix that fills the time best, oldest first.
    expect(ids(plan(list(), 28, "fill", false))).toStrictEqual(["tiny", "big"]);
    // Asked again goes first when it fits.
    const again = [make("old", 10, 9, false), make("again", 20, 1, true), make("mid", 12, 5, false)];
    expect(ids(plan(again, 30, "oldest", true))).toStrictEqual(["again", "old"]);
    expect(ids(plan(again, 30, "oldest", false))).toStrictEqual(["old", "mid"]);
  });

  it("fills with the most pull requests among mixes as long", () => {
    // 10 alone, or 4 + 6: the same minutes, more pull requests.
    const mix = [make("ten", 10, 3, false), make("four", 4, 2, false), make("six", 6, 1, false)];
    expect(ids(plan(mix, 10, "fill", false))).toStrictEqual(["four", "six"]);
    // Equal estimates go oldest first.
    expect(ids(plan([make("b", 5, 1, false), make("a", 5, 2, false)], 5, "quickest", false))).toStrictEqual(["a"]);
  });

  it("picks one even when none fits", () => {
    const over = plan([make("huge", 50, 1, false), make("bigger", 70, 3, false)], 30, "oldest", false);
    expect(ids(over)).toStrictEqual(["bigger"]);
    expect([over.overBy, over.left]).toStrictEqual([40, 1]);
    expect(plan([], 30, "fill", true).picked).toStrictEqual([]);
    // With no room at all left for the mix.
    expect(ids(plan([make("x", 3, 1, false)], 0, "fill", false))).toStrictEqual(["x"]);
  });
});

const run = (pulls: Candidate[], left = 0, overBy = 0, name = "Review time"): Run => ({
  session: "a",
  name,
  minutes: 30,
  startedAt: MONDAY,
  pulls: pulls.map((c) => c.pull),
  left,
  overBy,
});

describe("what review time says", () => {
  const two = run([make("Fix login", 9, 1, false), make("Docs", 4, 1, false)], 2);

  it("says it in English", () => {
    expect(offerWords(two, ENGLISH_REVIEW)).toStrictEqual({
      title: "Review time: 2 pull requests, about 13 min",
      body: "Fix login · ~9 min\nDocs · ~4 min\n2 more waiting didn't fit.",
    });
    expect(endWords(two, 1, ENGLISH_REVIEW).body).toBe("You reviewed 1 of 2.");
    expect(endWords(two, 0, ENGLISH_REVIEW)).toStrictEqual({
      title: "Review time is up",
      body: "You went through all of them.",
    });
  });

  it("says it in Portuguese", () => {
    expect(offerWords(two, PORTUGUESE_REVIEW)).toStrictEqual({
      title: "Review time: 2 pull requests, cerca de 13 min",
      body: "Fix login · ~9 min\nDocs · ~4 min\nMais 2 não couberam.",
    });
    expect(endWords(two, 1, PORTUGUESE_REVIEW)).toStrictEqual({
      title: "O review time acabou",
      body: "Você revisou 1 de 2 pull requests.",
    });
    expect(endWords(two, 0, PORTUGUESE_REVIEW).body).toBe("Você passou por todos.");
    expect(endWords(run([], 0, 0, "Tarde"), 0, PORTUGUESE_REVIEW).title).toBe("Tarde acabou");
  });

  it("says none, one, many and running over", () => {
    expect(offerWords(run([]), ENGLISH_REVIEW)).toStrictEqual({
      title: "Review time: nothing waiting on your review",
      body: "",
    });
    const one = run([make("Huge", 50, 1, false)], 1, 20, "Mornings");
    expect(offerWords(one, ENGLISH_REVIEW)).toStrictEqual({
      title: "Mornings: 1 pull request, about 50 min",
      body: "The one picked takes about 50 min, 20 min more than the 30 set aside.\nHuge · ~50 min\n1 more waiting didn't fit.",
    });
    expect(offerWords({ ...one, pulls: [] }, ENGLISH_REVIEW).body).toContain("about 0 min, 20 min more");
    const six = run(["a", "b", "c", "d", "e", "f"].map((id) => make(id, 1, 1, false)));
    expect(offerWords(six, ENGLISH_REVIEW).body.split("\n").at(-1)).toBe("and 2 more");
    expect(offerWords(six, PORTUGUESE_REVIEW).body.split("\n").at(-1)).toBe("e mais 2");
    expect(PORTUGUESE_REVIEW.oneLeft).toBe("Mais 1 não coube.");
    expect(offerWords(run([]), PORTUGUESE_REVIEW).title).toBe("Review time: nada esperando sua revisão");
    expect(offerWords(one, PORTUGUESE_REVIEW).title).toBe("Mornings: 1 pull request, cerca de 50 min");
    expect(PORTUGUESE_REVIEW.over(50, 20, 30)).toBe(
      "O escolhido leva cerca de 50 min, 20 min a mais que os 30 min reservados.",
    );
    const single = run([make("Fix", 5, 1, false)]);
    expect(endWords(single, 1, ENGLISH_REVIEW).body).toBe("You reviewed 0 of 1.");
    expect(endWords(single, 1, PORTUGUESE_REVIEW).body).toBe("Você revisou 0 de 1 pull request.");
    expect(endWords(single, 0, ENGLISH_REVIEW).title).toBe("Review time is up");
  });

  it("counts the minutes left", () => {
    expect(endsAt(two)).toBe(MONDAY + 30 * MINUTE);
    expect(minutesLeft(two, MONDAY + 29 * MINUTE + 1)).toBe(1);
    expect(minutesLeft(two, MONDAY)).toBe(30);
    expect(minutesLeft(two, MONDAY + HOUR)).toBe(0);
  });
});
