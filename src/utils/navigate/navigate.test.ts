import { describe, expect, it } from "vitest";
import { stepFile } from "@/utils/navigate/navigate";

const paths = ["a.ts", "b.ts", "c.ts"];

describe("stepping through files", () => {
  it("goes to the next file, stopping at the last", () => {
    expect(stepFile(paths, { path: "a.ts", reached: true }, 1)).toBe("b.ts");
    expect(stepFile(paths, { path: "c.ts", reached: true }, 1)).toBe("c.ts");
  });

  it("goes back to the start of a file read partway, then the one before", () => {
    expect(stepFile(paths, { path: "b.ts", reached: false }, -1)).toBe("b.ts");
    expect(stepFile(paths, { path: "b.ts", reached: true }, -1)).toBe("a.ts");
    expect(stepFile(paths, { path: "a.ts", reached: true }, -1)).toBe("a.ts");
  });

  it("starts at an end when nothing's on screen", () => {
    expect(stepFile(paths, null, 1)).toBe("a.ts");
    expect(stepFile(paths, null, -1)).toBe("c.ts");
    expect(stepFile([], null, 1)).toBeUndefined();
  });
});
