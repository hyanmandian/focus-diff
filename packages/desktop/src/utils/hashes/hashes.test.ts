import { describe, expect, it } from "vite-plus/test";

import { hash, patchHash } from "@/utils/hashes/hashes";

describe("a patch's hash", () => {
  it("is the hash of the patch, kept per file", () => {
    const file = { patch: "@@ -1 +1 @@\n-a\n+b\n" };
    expect(patchHash(file)).toBe(hash(file.patch));
    file.patch = "changed";
    expect(patchHash(file)).toBe(hash("@@ -1 +1 @@\n-a\n+b\n"));
  });

  it("differs for another patch in another file", () => {
    expect(patchHash({ patch: "a" })).not.toBe(patchHash({ patch: "b" }));
  });
});
