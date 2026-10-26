import { describe, expect, it } from "vitest";

import {
  enabledQueues,
  isScheduled,
  leavesOut,
  minutesOf,
  needsFiles,
  parseConfig,
  queueWith,
  waitsForReview,
  type ReviewTime,
} from "./queue-config";

describe("parseConfig", () => {
  it("fills in what's missing with config.rs's defaults", () => {
    expect(parseConfig({})).toStrictEqual({
      queues: [],
      pollSeconds: 60,
      sound: false,
      reviewTime: {
        enabled: false,
        sessions: [],
        againFirst: true,
        remindEnd: true,
        skipEmpty: true,
        holdWhileReviewing: false,
      },
    });
    expect(parseConfig({ queues: [{ id: "q" }] })?.queues).toStrictEqual([queueWith({ id: "q" })]);
  });

  it("reads queues, unknown names falling back", () => {
    const [queue] = parseConfig({
      queues: [
        {
          id: "a",
          name: "Mine",
          kind: "authored",
          drafts: "only",
          skipIfI: "approved",
          notifyAt: "review",
          enabled: false,
        },
        { id: "b", kind: "later", drafts: "maybe", skipIfI: "?", notifyAt: "soon" },
        { name: "no id" },
      ],
    })!.queues;
    expect(queue).toMatchObject({
      name: "Mine",
      kind: "authored",
      drafts: "only",
      skipIfI: "approved",
      notifyAt: "review",
    });
    expect(
      parseConfig({ queues: [{ id: "b", kind: "later", drafts: "maybe", skipIfI: "?", notifyAt: "soon" }] })?.queues[0],
    ).toMatchObject({
      kind: "custom",
      drafts: "hide",
      skipIfI: "tookPart",
      notifyAt: "now",
    });
    expect(parseConfig({ queues: [{ id: "c", notifyAt: null }] })?.queues[0]?.notifyAt).toBeNull();
  });

  it("keeps the rhythm and review times within bounds", () => {
    expect(parseConfig({ pollSeconds: 5 })?.pollSeconds).toBe(30);
    expect(parseConfig({ pollSeconds: 5000 })?.pollSeconds).toBe(900);
    const [session] = parseConfig({
      reviewTime: { sessions: [{ minutes: 1, days: [0, 6, 7], times: ["09:30", "9:30", "24:00", "12:60", "ab:cd"] }] },
    })!.reviewTime.sessions;
    expect(session).toStrictEqual({
      id: "",
      name: "",
      on: true,
      days: [0, 6],
      times: ["09:30"],
      minutes: 5,
      order: "oldest",
      queues: [],
      drafts: false,
    });
    expect(parseConfig({ reviewTime: { sessions: [{ minutes: 999 }] } })?.reviewTime.sessions[0]).toMatchObject({
      minutes: 240,
      days: [1, 2, 3, 4, 5],
      times: ["15:00"],
    });
  });

  it("isn't a setup when a field has the wrong type", () => {
    for (const bad of [
      null,
      [],
      { queues: {} },
      { queues: [{ id: 1 }] },
      { sound: "yes" },
      { reviewTime: null },
      { pollSeconds: -1 },
    ]) {
      expect(parseConfig(bad)).toBeNull();
    }
  });
});

describe("a queue's settings", () => {
  it("say what it needs and does", () => {
    expect(needsFiles(queueWith({}))).toBe(false);
    expect(needsFiles(queueWith({ excludePaths: "x" }))).toBe(true);
    expect(needsFiles(queueWith({ includePaths: "x" }))).toBe(true);
    expect(waitsForReview(queueWith({ kind: "review" }))).toBe(true);
    expect(waitsForReview(queueWith({ kind: "authored" }))).toBe(false);
    expect(waitsForReview(queueWith({ kind: "review", notifyAt: "now" }))).toBe(false);
    expect(waitsForReview(queueWith({ kind: "custom", notifyAt: "review" }))).toBe(true);
    expect(leavesOut(queueWith({ notifyLeaveOut: ["bots"] }), "bots")).toBe(true);
    expect(leavesOut(queueWith({}), "bots")).toBe(false);
    const config = parseConfig({ queues: [{ id: "a" }, { id: "b", enabled: false }] })!;
    expect(enabledQueues(config).map((q) => q.id)).toStrictEqual(["a"]);
  });
});

describe("review time", () => {
  it("reads times of day", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("23:59")).toBe(23 * 60 + 59);
    for (const bad of ["24:00", "12:60", "1:00", "12:00:00", "", "+1:00"]) expect(minutesOf(bad)).toBeNull();
  });

  it("is scheduled when a session is on, on some day, at some time", () => {
    const session = {
      id: "s",
      name: "",
      on: true,
      days: [1],
      times: ["15:00"],
      minutes: 30,
      order: "oldest",
      queues: [],
      drafts: false,
    } as const;
    const time = (patch: Partial<ReviewTime>): ReviewTime => ({
      enabled: true,
      sessions: [session],
      againFirst: true,
      remindEnd: true,
      skipEmpty: true,
      holdWhileReviewing: false,
      ...patch,
    });
    expect(isScheduled(time({}))).toBe(true);
    expect(isScheduled(time({ enabled: false }))).toBe(false);
    expect(isScheduled(time({ sessions: [{ ...session, on: false }] }))).toBe(false);
    expect(isScheduled(time({ sessions: [{ ...session, days: [] }] }))).toBe(false);
    expect(isScheduled(time({ sessions: [{ ...session, times: ["25:00"] }] }))).toBe(false);
  });
});
