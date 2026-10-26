import { LINES_PER_HOUR } from "@focus-diff/core/estimate";
import { describe, expect, it } from "vitest";

import { PACES } from "./review-time";

describe("PACES", () => {
  it("reads at half the starting pace when careful and twice it when quick", () => {
    expect(PACES).toEqual({ careful: LINES_PER_HOUR / 2, steady: LINES_PER_HOUR, quick: LINES_PER_HOUR * 2 });
  });
});
