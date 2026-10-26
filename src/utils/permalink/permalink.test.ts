import { describe, expect, it } from "vite-plus/test";

import { diffLines, diffLink, linesAnchor, permalink, sha256 } from "@/utils/permalink/permalink";

const repo = { owner: "acme", repo: "web" };

describe("links to code", () => {
  it("names the commit and the lines", () => {
    expect(permalink(repo, "abc123", "src/a b.ts", { start: 12, end: 10 })).toBe(
      "https://github.com/acme/web/blob/abc123/src/a%20b.ts#L10-L12",
    );
    expect(permalink(repo, "abc123", "src/a.ts")).toBe("https://github.com/acme/web/blob/abc123/src/a.ts");
    expect(linesAnchor(4)).toBe("#L4");
  });

  it("marks the diff's sides as GitHub does", () => {
    expect(diffLines("additions", 10)).toBe("R10");
    expect(diffLines("deletions", 3, 5)).toBe("L3-L5");
    expect(diffLines("additions", 3, 6, "deletions")).toBe("L3-R6");
  });

  it("anchors the diff by the SHA-256 of the path", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await diffLink({ ...repo, number: 7 }, "abc", { side: "additions", start: 2 })).toBe(
      "https://github.com/acme/web/pull/7/files#diff-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015adR2",
    );
  });

  it("links to the whole file when no line is picked", async () => {
    const file =
      "https://github.com/acme/web/pull/7/files#diff-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await diffLink({ ...repo, number: 7 }, "abc")).toBe(file);
    expect(await diffLink({ ...repo, number: 7 }, "abc", { side: "deletions", start: 0 })).toBe(file);
  });
});
