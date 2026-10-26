import { describe, expect, it } from "vitest";
import { hash, patchHash } from "./hashes";

describe("a patch's hash", () => {
  it("is the hash of the patch, kept per file", () => {
    const file = { patch: "@@ -1 +1 @@\n-a\n+b\n" };
    expect(patchHash(file)).toBe(hash(file.patch));
    // Worked out once: the same object answers the same, however often it's asked.
    (file as { patch: string }).patch = "changed";
    expect(patchHash(file)).toBe(hash("@@ -1 +1 @@\n-a\n+b\n"));
  });

  it("differs for another patch in another file", () => {
    expect(patchHash({ patch: "a" })).not.toBe(patchHash({ patch: "b" }));
  });
});
