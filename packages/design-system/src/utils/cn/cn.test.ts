import { describe, expect, it } from "vite-plus/test";

import { cn } from "./cn";

describe("class merging", () => {
  it("keeps a text style and a text colour together", () => {
    expect(cn("text-body", "text-destructive")).toBe("text-body text-destructive");
  });

  it("lets a later text style replace an earlier one", () => {
    expect(cn("text-body", false, "text-title1")).toBe("text-title1");
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
