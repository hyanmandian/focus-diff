import { describe, expect, it } from "vitest";

import { durationParts, roundMinutes } from "./duration";

describe("roundMinutes", () => {
  it("rounds to minutes, then to five minute steps past an hour", () => {
    expect(roundMinutes(7.5)).toBe(8);
    expect(roundMinutes(59.6)).toBe(60);
    expect(roundMinutes(79.5)).toBe(80);
    expect(roundMinutes(250)).toBe(250);
    expect(roundMinutes(252)).toBe(250);
  });
});

describe("durationParts", () => {
  it("has nothing to say under a minute", () => {
    expect(durationParts(0.4)).toBeNull();
  });

  it("gives whole minutes under an hour", () => {
    expect(durationParts(7.5)).toEqual({ hours: 0, minutes: 8 });
    expect(durationParts(59.6)).toEqual({ hours: 0, minutes: 60 });
  });

  it("gives hours and five-minute steps past an hour", () => {
    expect(durationParts(60)).toEqual({ hours: 1, minutes: 0 });
    expect(durationParts(79.5)).toEqual({ hours: 1, minutes: 20 });
    expect(durationParts(122)).toEqual({ hours: 2, minutes: 0 });
  });
});
