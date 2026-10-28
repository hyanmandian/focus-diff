import { createEstimator, LINES_PER_HOUR, reviewMinutes } from "@focus-diff/core/estimate";
import { describe, expect, it } from "vitest";

import type { Config } from "@/utils/filters/filters";
import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { samplePull } from "@/utils/github-sample-pull/github-sample-pull";

import {
  candidates,
  DEFAULT_REVIEW_TIME,
  estimate,
  isScheduled,
  newSession,
  nextOccurrence,
  normalizeReviewTime,
  plan,
  presetSession,
  pullMinutes,
  REVIEW_PRESETS,
  runEndsAt,
  runPulls,
  sessionFilterIds,
  sessionMatchers,
  startsOf,
  type Planned,
  type PullFile,
  type ReviewRun,
  type ReviewSession,
} from "./review-sessions";

const pull = (number: number, extra: Partial<PullRequest> = {}) =>
  samplePull(number, {
    createdAt: `2026-10-0${number % 9}T12:00:00Z`,
    updatedAt: "2026-10-09T12:00:00Z",
    headSha: "abc",
    ...extra,
  });

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({ ...newSession(), id: "s1", ...extra });
const settings = (extra: Partial<ReviewSession> = {}) => ({
  ...DEFAULT_REVIEW_TIME,
  enabled: true,
  sessions: [session(extra)],
});
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const planned = (number: number, minutes: number, extra: Partial<PullRequest> = {}): Planned => ({
  pull: pull(number, extra),
  estimate: { minutes, files: 1 },
});

describe("normalizeReviewTime", () => {
  it("fills in what is missing and drops what is wrong", () => {
    const value = normalizeReviewTime({
      enabled: true,
      pace: "sprint",
      sessions: [
        { id: "a", days: [1, 9, 1], times: ["15:00", "25:00", "09:30"], minutes: 999, order: "random", every: 7 },
      ],
    });
    expect(value.pace).toBe("steady");
    expect(value.sessions[0]).toMatchObject({
      id: "a",
      days: [1],
      times: ["09:30", "15:00"],
      minutes: 240,
      order: "oldest",
      every: 2,
    });
    expect(value.sound).toEqual({ id: "bowl", volume: 70 });
  });

  it("starts afresh from what isn't settings at all", () => {
    expect(normalizeReviewTime(null)).toEqual(DEFAULT_REVIEW_TIME);
    const value = normalizeReviewTime({ sessions: [{ id: "", name: 7, days: "weekdays", times: null, filters: "x" }] });
    expect(value.sessions[0]).toMatchObject({ name: "", days: [1, 2, 3, 4, 5], times: ["15:00"], filters: [] });
    expect(value.sessions[0]?.id).not.toBe("");
  });

  it("keeps a name trimmed and short, valid times, and each filter once", () => {
    const value = normalizeReviewTime({
      sessions: [
        {
          name: `  ${"x".repeat(70)}  `,
          from: "8:00",
          to: "17:30",
          minutes: "soon",
          filters: ["a", 1, "a", "b"],
          on: false,
          drafts: true,
        },
      ],
    });
    expect(value.sessions[0]).toMatchObject({
      name: "x".repeat(60),
      from: "09:00",
      to: "17:30",
      minutes: 30,
      filters: ["a", "b"],
      on: false,
      drafts: true,
    });
  });

  it("keeps two sessions apart even when another device gave them the same id", () => {
    const value = normalizeReviewTime({ sessions: [{ id: "a" }, { id: "a" }] });
    expect(new Set(value.sessions.map((each) => each.id)).size).toBe(2);
  });
});

describe("schedule", () => {
  it("starts at set times, or every few hours up to the end of a span", () => {
    expect(startsOf(session({ times: ["09:00", "15:30"] }))).toEqual([540, 930]);
    expect(startsOf(session({ repeat: "every", every: 3, from: "09:00", to: "18:00" }))).toEqual([540, 720, 900, 1080]);
  });

  it("finds the next one, skipping the days it is off", () => {
    const weekdays = settings({ times: ["15:00"] });
    expect(nextOccurrence(weekdays, at(9, 10))?.at).toBe(at(9, 15));
    expect(nextOccurrence(weekdays, at(9, 15))?.at).toBe(at(12, 15));
    expect(nextOccurrence({ ...weekdays, enabled: false }, at(9, 10))).toBeNull();
    expect(nextOccurrence(settings({ on: false }), at(9, 10))).toBeNull();
  });

  it("picks the earliest of two sessions on the same day", () => {
    const value = {
      ...DEFAULT_REVIEW_TIME,
      enabled: true,
      sessions: [session({ id: "late", times: ["16:00"] }), session({ id: "early", times: ["11:00"] })],
    };
    expect(nextOccurrence(value, at(9, 10))?.session.id).toBe("early");
  });

  it("finds none in a week with no days on", () => {
    expect(nextOccurrence(settings({ days: [] }), at(9, 10))).toBeNull();
  });

  it("is scheduled only when on, with a session on that has days and times", () => {
    expect(isScheduled(settings())).toBe(true);
    expect(isScheduled({ ...settings(), enabled: false })).toBe(false);
    expect(isScheduled(settings({ on: false }))).toBe(false);
    expect(isScheduled(settings({ days: [] }))).toBe(false);
    expect(isScheduled(settings({ times: [] }))).toBe(false);
  });
});

describe("estimate", () => {
  const files: PullFile[] = [
    ["src/app.ts", 1000, 0, false],
    ["src/app.test.ts", 500, 0, false],
    ["src/old.ts", 1000, 0, true],
  ];
  const config: Config = {
    global: [{ id: "tests", name: "Tests", include: "\\.test\\.", exclude: "" }],
    repos: [{ repo: "octo/api", filters: [{ id: "api", name: "API", include: "^api/", exclude: "" }] }],
  };

  it("reads the files left to review at the reader’s pace, and a moment for the pull request", () => {
    const minutes = (path: string, additions: number) => reviewMinutes(path, { additions, deletions: 0 });
    expect(estimate(files, null, DEFAULT_REVIEW_TIME, reviewMinutes)).toEqual({
      minutes: DEFAULT_REVIEW_TIME.perPull + minutes("src/app.ts", 1000) + minutes("src/app.test.ts", 500),
      files: 2,
    });
    expect(estimate(files, null, { ...DEFAULT_REVIEW_TIME, unviewedOnly: false }, reviewMinutes).files).toBe(3);
  });

  it("counts only the files in the session’s filters, and nothing at all when none of them are", () => {
    const tests = sessionMatchers(config, "octo/web", ["tests"]);
    expect(estimate(files, tests, DEFAULT_REVIEW_TIME, reviewMinutes).files).toBe(1);
    expect(estimate([["README.md", 3, 0, false]], tests, DEFAULT_REVIEW_TIME, reviewMinutes)).toEqual({
      minutes: 0,
      files: 0,
    });
  });

  it("counts every file without filters, and leaves out a filter that doesn't compile", () => {
    expect(sessionMatchers(config, "octo/web", [])).toBeNull();
    const broken: Config = { global: [{ id: "bad", name: "Bad", include: "(", exclude: "" }], repos: [] };
    expect(sessionMatchers(broken, "octo/web", ["bad"])).toBeNull();
  });

  it("reviews a repository whole when none of the filters are for it", () => {
    expect(sessionMatchers(config, "octo/web", ["api"])).toBeNull();
    expect(sessionFilterIds(config, "octo/api", ["api", "tests"])).toEqual(["tests", "api"]);
  });

  it("follows the reader’s pace", () => {
    const slow = createEstimator(LINES_PER_HOUR / 2, null);
    expect(slow("src/app.ts", { additions: 1000, deletions: 0 })).toBeCloseTo(
      reviewMinutes("src/app.ts", { additions: 2000, deletions: 0 }),
    );
  });
});

describe("pullMinutes", () => {
  const files: PullFile[] = [["src/app.ts", 100, 0, false]];
  it("takes the whole pull request, from files read at its latest push", () => {
    const minutes = pullMinutes(pull(1), { sha: "abc", files }, DEFAULT_REVIEW_TIME, reviewMinutes);
    expect(minutes).toBe(DEFAULT_REVIEW_TIME.perPull + reviewMinutes("src/app.ts", { additions: 100, deletions: 0 }));
    expect(pullMinutes(pull(1), { sha: "old", files }, DEFAULT_REVIEW_TIME, reviewMinutes)).toBeNull();
    expect(pullMinutes(pull(1), undefined, DEFAULT_REVIEW_TIME, reviewMinutes)).toBeNull();
    expect(
      pullMinutes(pull(1), { sha: "abc", files: [["a.ts", 1, 0, true]] }, DEFAULT_REVIEW_TIME, reviewMinutes),
    ).toBeNull();
  });
});

describe("candidates", () => {
  it("leaves out drafts unless asked, and the repositories not wanted", () => {
    const pulls = [pull(1), pull(2, { draft: true }), pull(3, { repo: "octo/legacy" }), pull(4, { repo: "other/app" })];
    expect(candidates(session({ excludeRepos: ["octo/legacy"] }), pulls).map((each) => each.number)).toEqual([1, 4]);
    expect(candidates(session({ drafts: true, repos: ["octo/*"] }), pulls).map((each) => each.number)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("plan", () => {
  const items = [planned(1, 25), planned(2, 10), planned(3, 8), planned(4, 14)];

  it("takes the ones waiting longest that still fit", () => {
    const result = plan(items, 30, "oldest");
    expect(result.picked.map((item) => item.pull.number)).toEqual([1]);
    expect(result.left).toHaveLength(3);
    expect(result.overBy).toBe(0);
  });

  it("takes the quickest first, as many as fit", () => {
    expect(plan(items, 30, "quickest").picked.map((item) => item.pull.number)).toEqual([3, 2]);
  });

  it("fills the time best, where going in order would leave most of it unused", () => {
    expect(plan(items, 32, "oldest").total).toBe(25);
    const result = plan(items, 32, "fill");
    expect(result.picked.map((item) => item.pull.number)).toEqual([2, 3, 4]);
    expect(result.total).toBe(32);
  });

  it("picks one even when none fits, and says by how much it runs over", () => {
    const result = plan([planned(1, 50), planned(2, 45)], 30, "oldest");
    expect(result.picked.map((item) => item.pull.number)).toEqual([1]);
    expect(result.overBy).toBe(20);
    expect(plan([planned(1, 50), planned(2, 45)], 30, "quickest").picked.map((item) => item.pull.number)).toEqual([2]);
  });

  it("sets aside the ones with nothing to review, and gives the ones it couldn’t read a rough guess", () => {
    const empty = { pull: pull(5), estimate: { minutes: 0, files: 0 } };
    const unread = { pull: pull(6), estimate: { minutes: 12, files: 0, guessed: true } };
    const result = plan([empty, unread, planned(1, 5)], 30, "oldest");
    expect(result.nothing.map((each) => each.number)).toEqual([5]);
    expect(result.picked.map((item) => item.pull.number)).toEqual([1, 6]);
  });

  it("fits the rest in what the ones asked for again leave, to the fraction of a minute", () => {
    const odd = [planned(1, 10.4, { again: true }), planned(2, 19.5)];
    expect(plan(odd, 30, "oldest", true).picked.map((item) => item.pull.number)).toEqual([1, 2]);
    expect(plan(odd, 30, "fill", true).picked.map((item) => item.pull.number)).toEqual([1]);
  });

  it("puts the ones asked for again first, when they fit, in the session’s order after that", () => {
    const again = [planned(1, 25), planned(2, 10, { again: true }), planned(3, 8), planned(4, 14, { again: true })];
    expect(plan(again, 30, "oldest", true).picked.map((item) => item.pull.number)).toEqual([2, 4]);
    expect(plan(again, 30, "oldest").picked.map((item) => item.pull.number)).toEqual([1]);
    expect(plan(again, 32, "fill", true).picked.map((item) => item.pull.number)).toEqual([2, 4, 3]);
    expect(
      plan([planned(1, 50, { again: true }), planned(2, 10)], 30, "oldest", true).picked.map(
        (item) => item.pull.number,
      ),
    ).toEqual([2]);
    expect(
      plan([planned(1, 50), planned(2, 40, { again: true })], 30, "oldest", true).picked.map(
        (item) => item.pull.number,
      ),
    ).toEqual([2]);
  });

  it("orders by when a pull request was updated when it has no creation date, and equal sizes by age", () => {
    const undated = (number: number, minutes: number, updatedAt: string) =>
      planned(number, minutes, { createdAt: "", updatedAt });
    const dated = [undated(1, 5, "2026-10-05T00:00:00Z"), undated(2, 5, "2026-10-02T00:00:00Z")];
    expect(plan(dated, 30, "oldest").picked.map((item) => item.pull.number)).toEqual([2, 1]);
    expect(plan(dated, 30, "quickest").picked.map((item) => item.pull.number)).toEqual([2, 1]);
  });

  it("fills the time with more pull requests when the minutes come to the same", () => {
    const sizes = [planned(1, 10), planned(2, 5), planned(3, 5), planned(4, 10)];
    expect(plan(sizes, 10, "fill").picked.map((item) => item.pull.number)).toEqual([2, 3]);
  });

  it("fills with the smallest when even that one doesn’t fit", () => {
    const result = plan([planned(1, 50), planned(2, 40)], 30, "fill");
    expect(result.picked.map((item) => item.pull.number)).toEqual([2]);
    expect(result.overBy).toBe(10);
  });
});

describe("runs", () => {
  it("lists what was picked as the popup shows it, at least a minute each", () => {
    const pulls = runPulls([
      planned(1, 0.2),
      { pull: pull(2, { again: true }), estimate: { minutes: 12, files: 0, guessed: true } },
    ]);
    expect(pulls).toEqual([
      expect.objectContaining({ number: 1, minutes: 1, files: 1 }),
      expect.objectContaining({ number: 2, minutes: 12, files: null, again: true }),
    ]);
    expect(pulls[0]).not.toHaveProperty("again");
  });

  it("ends its minutes after it started, or after it was offered when it never did", () => {
    const run: ReviewRun = {
      session: "s1",
      name: "",
      minutes: 30,
      offeredAt: 1000,
      startedAt: null,
      pulls: [],
      left: 0,
      overBy: 0,
      filters: [],
    };
    expect(runEndsAt(run)).toBe(1000 + 30 * 60_000);
    expect(runEndsAt({ ...run, startedAt: 5000 })).toBe(5000 + 30 * 60_000);
  });
});

describe("presetSession", () => {
  it("makes a session of the reader's own, named, whose id says which preset", () => {
    const value = presetSession(REVIEW_PRESETS[1]!, "Afternoons");
    expect(value).toMatchObject({ id: "preset-every", name: "Afternoons", repeat: "every", minutes: 15 });
  });
});
