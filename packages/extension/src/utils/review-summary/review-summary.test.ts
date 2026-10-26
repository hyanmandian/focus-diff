import { afterEach, describe, expect, it, vi } from "vitest";

import { newSession, type ReviewSession } from "@/utils/review-sessions/review-sessions";

// The reader's language is read once, as the module loads, before the setup's beforeEach gives the fake browser one.
await vi.hoisted(async () => {
  const { fakeBrowser } = await import("wxt/testing/fake-browser");
  Object.assign(fakeBrowser.i18n, { getUILanguage: () => "en-US" });
});

import { dayName, sessionSummary, time, WEEK } from "./review-summary";

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({ ...newSession(), ...extra });

describe("sessionSummary", () => {
  it("names common sets of days in a word", () => {
    expect(sessionSummary(session({ days: [0, 1, 2, 3, 4, 5, 6] }))).toBe("Every day at 3:00 PM · 30 min");
    expect(sessionSummary(session())).toBe("Weekdays at 3:00 PM · 30 min");
    expect(sessionSummary(session({ days: [0, 6], minutes: 45 }))).toBe("Weekends at 3:00 PM · 45 min");
  });

  it("lists other days in the week's order, and its times", () => {
    expect(sessionSummary(session({ days: [1, 3], times: ["09:30", "15:00"] }))).toBe(
      "Mon and Wed at 9:30 AM and 3:00 PM · 30 min",
    );
  });

  it("says when no day or no time is picked", () => {
    expect(sessionSummary(session({ days: [] }))).toBe("No days picked");
    expect(sessionSummary(session({ times: [] }))).toBe("Weekdays with no time yet · 30 min");
  });

  it("says how often, and between when, for a session every few hours", () => {
    expect(sessionSummary(session({ repeat: "every", every: 1 }))).toBe(
      "Weekdays every hour from 9:00 AM to 6:00 PM · 30 min",
    );
    expect(sessionSummary(session({ repeat: "every", every: 3 }))).toBe(
      "Weekdays every 3 hours from 9:00 AM to 6:00 PM · 30 min",
    );
  });
});

describe("days and times", () => {
  it("names days and formats times in the reader's language", () => {
    expect(dayName(1, "short")).toBe("Mon");
    expect(dayName(0, "long")).toBe("Sunday");
    expect(time("07:05")).toBe("7:05 AM");
  });

  it("starts the week on the day the language does", () => {
    expect(WEEK).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("the first day of the week", () => {
  afterEach(() => {
    vi.resetModules();
  });

  const weekWith = async (info: object) => {
    vi.resetModules();
    // Only the week's start is read as it loads.
    vi.stubGlobal("Intl", {
      Locale: vi.fn<() => object>(function locale() {
        return info;
      }),
    });
    const { WEEK: week } = await import("./review-summary");
    vi.unstubAllGlobals();
    return week;
  };

  it("reads it from the locale, the older way, or starts on Sunday", async () => {
    expect(await weekWith({ getWeekInfo: () => ({ firstDay: 1 }) })).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(await weekWith({ weekInfo: { firstDay: 6 } })).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(await weekWith({})).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
