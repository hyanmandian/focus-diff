import { describe, expect, it } from "vitest";

import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { sampleActivity, sampleNotify, samplePull } from "@/utils/github-sample-pull/github-sample-pull";

import {
  activityKind,
  DEFAULT_NOTIFY,
  freshActivity,
  ignore,
  inPopup,
  invalidRepos,
  isDone,
  isIgnored,
  isQuiet,
  isWatching,
  markAgain,
  markDone,
  needsDetail,
  normalizeNotify,
  normalizePopup,
  popupLists,
  pruneDone,
  pruneIgnored,
  rememberThreads,
  reviewListEvents,
  splitRepos,
  unignore,
  unmarkDone,
  wants,
  type InboxEvent,
} from "./inbox";

const pull = samplePull;

const activity = sampleActivity;

const on = sampleNotify;

describe("normalizeNotify", () => {
  it("starts from what most reviewers want, and keeps only exceptions that mean something", () => {
    const settings = normalizeNotify({
      enabled: true,
      repos: [" octo/* ", "octo/web", "octo/web"],
      events: {
        approved: { on: true, except: ["bots", "drafts", "bots"], when: "review" },
        mention: { on: "yes", when: "later" },
      },
    });
    expect(settings.repos).toEqual(["octo/*", "octo/web"]);
    expect(settings.events.approved).toEqual({ on: true, except: ["bots"], repos: [], when: "review" });
    expect(settings.events.mention).toEqual({ on: false, except: [], repos: [], when: "now" });
    expect(settings.events["review-requested"]).toEqual({ on: true, except: ["drafts"], repos: [], when: "review" });
    expect(normalizeNotify(null)).toMatchObject({ enabled: false, repos: [] });
  });
});

describe("normalizeNotify, the rest", () => {
  it("keeps a known interval and well-formed quiet hours, or falls back", () => {
    const settings = normalizeNotify({
      interval: 15,
      quiet: { on: true, from: "22:30", to: "7:00" },
      delivery: { grouped: true },
    });
    expect(settings.interval).toBe(15);
    expect(settings.quiet).toEqual({ on: true, from: "22:30", to: "09:00", weekends: true });
    expect(settings.delivery).toEqual({ grouped: true, sticky: false, sound: { id: "chime", volume: 60 } });
    expect(normalizeNotify({ delivery: { silent: true } }).delivery.sound.id).toBe("none");
    expect(normalizeNotify({ interval: 3 }).interval).toBe(2);
  });
});

describe("isQuiet", () => {
  const at = (day: number, time: string) => new Date(2026, 9, 4 + day, Number(time.slice(0, 2)), Number(time.slice(3)));
  const quiet = (from: string, to: string, weekends = false) => ({
    ...DEFAULT_NOTIFY,
    quiet: { on: true, from, to, weekends },
  });

  it("keeps quiet across midnight, within a day, and on weekends if asked", () => {
    expect(isQuiet(quiet("19:00", "09:00"), at(1, "23:00"))).toBe(true);
    expect(isQuiet(quiet("19:00", "09:00"), at(1, "08:59"))).toBe(true);
    expect(isQuiet(quiet("19:00", "09:00"), at(1, "09:00"))).toBe(false);
    expect(isQuiet(quiet("12:00", "14:00"), at(1, "13:00"))).toBe(true);
    expect(isQuiet(quiet("12:00", "14:00"), at(1, "15:00"))).toBe(false);
    expect(isQuiet(quiet("12:00", "14:00", true), at(0, "10:00"))).toBe(true);
    expect(isQuiet({ ...DEFAULT_NOTIFY }, at(1, "23:00"))).toBe(false);
  });
});

describe("splitRepos", () => {
  it("reads repositories apart by commas, spaces or lines", () => {
    expect(splitRepos(" octo/web, octo/*\nacme/api  octo/web ")).toEqual(["octo/web", "octo/*", "acme/api"]);
    expect(splitRepos("  ")).toEqual([]);
  });
});

describe("wants", () => {
  const event: InboxEvent = {
    kind: "comment-mine",
    repo: "octo/web",
    number: 1,
    title: "",
    url: "",
    actor: "bot",
    bot: true,
    draft: false,
    approvedByMe: false,
    team: false,
    again: false,
    excerpt: "",
  };

  it("takes the event in the chosen repositories, unless an exception applies", () => {
    expect(wants(on({ "comment-mine": [] }), event)).toBe(true);
    expect(wants(on({ "comment-mine": [] }, ["other/*", "octo/*"]), event)).toBe(true);
    expect(wants(on({ "comment-mine": [] }, ["other/*"]), event)).toBe(false);
    expect(wants(on({ "comment-mine": ["bots"] }), event)).toBe(false);
    expect(wants(on({ approved: [] }), event)).toBe(false);
  });

  it("takes an event’s own repositories over the general ones, and never the excluded ones", () => {
    const settings = on({ "comment-mine": [] }, ["other/*"]);
    settings.events["comment-mine"].repos = ["octo/web"];
    expect(wants(settings, event)).toBe(true);
    expect(wants({ ...settings, excludeRepos: ["octo/*"] }, event)).toBe(false);
  });
});

describe("reviewListEvents", () => {
  it("finds new review requests and drafts that are now ready, but nothing on the first look", () => {
    expect(reviewListEvents(null, [pull(1)])).toEqual([]);
    const events = reviewListEvents([pull(1, { draft: true }), pull(2)], [pull(1), pull(2), pull(3)]);
    expect(events.map(({ kind, number }) => [kind, number])).toEqual([
      ["ready-for-review", 1],
      ["review-requested", 3],
    ]);
  });
});

describe("markAgain", () => {
  const urls = (list: PullRequest[]) => list.filter((each) => each.again).map((each) => each.number);

  it("marks a pull request back on the queue after leaving it, until it leaves again", () => {
    const day = 86_400_000;
    let step = markAgain([pull(1), pull(2)], [pull(2)], {}, 0);
    expect(step.history).toEqual({ [pull(1).url]: { left: 0 } });
    step = markAgain([pull(2)], [pull(1), pull(2)], step.history, day);
    expect(urls(step.reviews)).toEqual([1]);
    step = markAgain(step.reviews, step.reviews, step.history, 2 * day);
    expect(urls(step.reviews)).toEqual([1]);
    step = markAgain(step.reviews, [pull(2)], step.history, 3 * day);
    expect(step.history[pull(1).url]).toEqual({ left: 3 * day });
  });

  it("marks nothing new on a first look, and forgets one gone for months", () => {
    expect(urls(markAgain(null, [pull(1)], {}, 0).reviews)).toEqual([]);
    const history = { [pull(1).url]: { left: 0 } };
    expect(urls(markAgain([], [pull(1)], history, 100 * 86_400_000).reviews)).toEqual([]);
  });
});

describe("inPopup", () => {
  it("lists the repositories picked, and the reviews asked of a team unless left out", () => {
    const settings = normalizePopup({ repos: ["octo/*"] });
    expect(settings.teams).toBe(true);
    expect(inPopup(settings, pull(1, { team: true }))).toBe(true);
    expect(inPopup({ ...settings, teams: false }, pull(1, { team: true }))).toBe(false);
    expect(inPopup({ ...settings, teams: false }, pull(1))).toBe(true);
    expect(inPopup(settings, { repo: "acme/api" })).toBe(false);
  });
});

describe("popupLists", () => {
  it("has the review queue and the reader's own always, and the lists they added", () => {
    expect(popupLists(normalizePopup({}))).toEqual(["reviews", "mine"]);
    expect(popupLists(normalizePopup({ merged: true }))).toEqual(["reviews", "mine", "merged"]);
    expect(popupLists(normalizePopup({ updates: true, merged: true }))).toEqual([
      "reviews",
      "mine",
      "updates",
      "merged",
    ]);
  });
});

describe("ignored", () => {
  it("hides a pull request from one list, whatever happens on it, until the reader brings it back", () => {
    const first = pull(1);
    const marks = ignore(ignore({}, "updates", first), "updates", first);
    expect(marks).toEqual({ updates: [first.url] });
    const updated: PullRequest = { ...first, updatedAt: "2030-01-01T00:00:00Z" };
    expect(isIgnored(marks, "updates", updated)).toBe(true);
    expect(isIgnored(marks, "reviews", first)).toBe(false);
    expect(isIgnored(unignore(marks, "updates", first), "updates", first)).toBe(false);
    expect(unignore({}, "merged", first)).toEqual({ merged: [] });
  });

  it("forgets marks off their list, and every mark of a list that isn't read", () => {
    const [first, second] = [pull(1), pull(2)];
    const marks = { reviews: [first.url, second.url], mine: [first.url], merged: [second.url] };
    expect(pruneIgnored(marks, { reviews: [second], mine: [], merged: undefined })).toEqual({
      reviews: [second.url],
    });
  });
});

describe("freshActivity", () => {
  it("finds threads updated since the last look", () => {
    const threads = [activity("a"), activity("b", { updatedAt: "2026-10-09T11:00:00Z" }), activity("c")];
    expect(freshActivity(null, threads)).toEqual([]);
    expect(
      freshActivity({ a: "2026-10-09T10:00:00Z", b: "2026-10-09T10:00:00Z" }, threads).map(({ thread }) => thread),
    ).toEqual(["b", "c"]);
  });
});

describe("done", () => {
  it("hides a pull request until something happens on it", () => {
    const done = markDone({}, [pull(1), pull(2)]);
    expect(isDone(done, pull(1))).toBe(true);
    expect(isDone(done, pull(1, { updatedAt: "2026-10-08T13:00:00Z" }))).toBe(false);
    expect(isDone(done, pull(3))).toBe(false);
    expect(isDone(unmarkDone(done, [pull(1)]), pull(1))).toBe(false);
  });

  it("forgets marks that no longer hide anything", () => {
    const done = markDone({}, [pull(1), pull(2), pull(3)]);
    expect(Object.keys(pruneDone(done, [pull(1), pull(2, { updatedAt: "2026-10-09T00:00:00Z" })]))).toEqual([
      "https://github.com/octo/web/pull/1",
    ]);
  });
});

describe("invalidRepos", () => {
  it("finds the ones that don't read as a repository path", () => {
    expect(invalidRepos(["octo/web", "octo/*", "octo", "/web"])).toEqual(["octo", "/web"]);
  });
});

describe("quiet hours, more", () => {
  it("falls back for a malformed start, and keeps Saturdays quiet too", () => {
    const settings = normalizeNotify({ quiet: { on: true, from: "25:00", to: "08:15", weekends: false } });
    expect(settings.quiet).toEqual({ on: true, from: "19:00", to: "08:15", weekends: false });
    const saturday = new Date(2026, 9, 10, 12, 0);
    expect(isQuiet({ ...settings, quiet: { ...settings.quiet, weekends: true } }, saturday)).toBe(true);
    expect(isQuiet(settings, saturday)).toBe(false);
    expect(isQuiet({ ...settings, quiet: { ...settings.quiet, from: "08:15" } }, saturday)).toBe(false);
  });
});

describe("isWatching", () => {
  it("watches only when notifications are on with some event to tell", () => {
    expect(isWatching(on({ mention: [] }))).toBe(true);
    expect(isWatching(on({}))).toBe(false);
    expect(isWatching({ ...on({ mention: [] }), enabled: false })).toBe(false);
  });
});

describe("needsDetail and the approved exception", () => {
  const event: InboxEvent = {
    kind: "ready-for-review",
    repo: "octo/web",
    number: 1,
    title: "",
    url: "",
    actor: "ada",
    bot: false,
    draft: false,
    approvedByMe: true,
    team: false,
    again: false,
    excerpt: "",
  };

  it("looks at the page only to know whether the reader approved, and then leaves the ones they did out", () => {
    const settings = on({ "ready-for-review": ["approved"] });
    expect(needsDetail(settings, "ready-for-review", "octo/web")).toBe(true);
    expect(needsDetail(on({ "ready-for-review": [] }), "ready-for-review", "octo/web")).toBe(false);
    expect(needsDetail(settings, "mention", "octo/web")).toBe(false);
    expect(wants(settings, event)).toBe(false);
    expect(wants(settings, { ...event, approvedByMe: false })).toBe(true);
    expect(wants(on({ "comment-mine": ["drafts"] }), { ...event, kind: "comment-mine", draft: true })).toBe(false);
  });
});

describe("activityKind", () => {
  it("tells what a thread's latest event was for the reader", () => {
    expect(activityKind(activity("a", { kind: "other" }), null)).toBeNull();
    expect(activityKind(activity("a", { reason: "mention" }), null)).toBe("mention");
    expect(activityKind(activity("a", { reason: "team_mention" }), "approved")).toBe("mention");
    expect(activityKind(activity("a", { kind: "review" }), "approved")).toBe("approved");
    expect(activityKind(activity("a", { kind: "review" }), "changes-requested")).toBe("changes-requested");
    expect(activityKind(activity("a", { kind: "review" }), "commented")).toBe("comment-mine");
    expect(activityKind(activity("a", { reason: "review_requested" }), null)).toBe("comment-reviewing");
    expect(activityKind(activity("a", { reason: "subscribed" }), null)).toBeNull();
  });
});

describe("rememberThreads", () => {
  it("keeps the latest update of each thread, at most three hundred, the latest first", () => {
    expect(rememberThreads([activity("a"), activity("b", { updatedAt: "2026-10-09T12:00:00Z" })], null)).toEqual({
      b: "2026-10-09T12:00:00Z",
      a: "2026-10-09T10:00:00Z",
    });
    const previous = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `old${index}`,
        `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`,
      ]),
    );
    const kept = rememberThreads([activity("new")], previous);
    expect(Object.keys(kept)).toHaveLength(300);
    expect(Object.keys(kept)[0]).toBe("new");
  });
});

describe("markAgain, more", () => {
  it("doesn't mark one that left by an earlier record but was on the last list", () => {
    const step = markAgain([pull(1)], [pull(1)], { [pull(1).url]: { left: 0 } }, 86_400_000);
    expect(step.history).toEqual({});
    expect(step.reviews[0]?.again).toBeUndefined();
    expect(markAgain([pull(1)], [pull(1, { again: true })], {}, 0).reviews[0]?.again).toBe(false);
  });
});
