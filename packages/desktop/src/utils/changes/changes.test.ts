import { describe, expect, it } from "vite-plus/test";

import { newer, parse, releasesBetween, releaseUrl, sawNews, updatedFrom } from "@/utils/changes/changes";
import { refuseStorage } from "@/utils/mock-render/mock-render";

const LOG = `# Changelog

## [1.2.0](https://github.com/acme/x/compare/v1.1.0...v1.2.0) (2026-10-30)


### Features

* **desktop:** pick diff filter presets during setup ([9293084](https://github.com/acme/x/commit/9293084))
* **desktop:** pick diff filter presets during setup ([abcdef1](https://github.com/acme/x/commit/abcdef1))


### Bug Fixes

* keep half-written replies ([e050325](https://github.com/acme/x/commit/e050325))

### Miscellaneous

* chore that nobody needs to see

## [1.1.0](https://github.com/acme/x/compare/v1.0.0...v1.1.0) (2026-10-29)

### Bug Fixes

* **desktop:** a fix

## 1.0.0 (2026-10-28)

### Documentation

* only docs
`;

describe("changes", () => {
  it("reads the changelog into releases, without scopes, links or repeats", () => {
    expect(parse(LOG)).toEqual([
      {
        version: "1.2.0",
        date: "2026-10-30",
        changes: [
          { kind: "feature", text: "Pick diff filter presets during setup" },
          { kind: "fix", text: "Keep half-written replies" },
        ],
      },
      { version: "1.1.0", date: "2026-10-29", changes: [{ kind: "fix", text: "A fix" }] },
    ]);
    expect(parse("* stray line\n")).toEqual([]);
  });

  it("compares versions", () => {
    expect(newer("1.10.0", "1.9.9")).toBe(true);
    expect(newer("1.2.0", "1.2.0")).toBe(false);
    expect(newer("1.2", "1.2.0")).toBe(false);
    expect(newer("2.0.0", "1.9")).toBe(true);
    expect(newer("1.2.1", "1.2")).toBe(true);
    expect(newer("1.2", "1.2.1")).toBe(false);
  });

  it("picks the releases since the one that was running", () => {
    expect(releasesBetween("1.1.0", "1.2.0", LOG).map((r) => r.version)).toEqual(["1.2.0"]);
    expect(releasesBetween(null, "1.1.0", LOG).map((r) => r.version)).toEqual(["1.1.0"]);
    expect(releasesBetween(null, "9.9.9").length).toBeGreaterThan(0);
  });

  it("links to a release on GitHub", () => {
    expect(releaseUrl("1.2.0")).toBe("https://github.com/hyanmandian/focus-diff/releases/tag/desktop-v1.2.0");
  });

  it("knows the app was updated, until the news is seen", () => {
    expect(updatedFrom("1.1.0")).toBeNull();
    expect(updatedFrom("1.1.0")).toBeNull();
    expect(updatedFrom("1.2.0")).toBe("1.1.0");
    sawNews("1.2.0");
    expect(updatedFrom("1.2.0")).toBeNull();
  });

  it("says nothing when storage can't be used", () => {
    const { get, set } = refuseStorage();
    expect(updatedFrom("1.2.0")).toBeNull();
    sawNews("1.2.0");
    get.mockRestore();
    set.mockRestore();
  });
});
