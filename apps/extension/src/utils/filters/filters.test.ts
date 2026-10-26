import { describe, expect, it } from "vitest";

import { filtersFor, isEmpty, normalize, REPO_PATTERN } from "./filters";

describe("filtersFor", () => {
  it("puts global filters first, then the matching repository filters", () => {
    const config = normalize({
      global: [{ name: "Docs", include: "\\.md$" }],
      repos: [
        { repo: "octo/web", filters: [{ name: "Web only" }] },
        { repo: "octo/*", filters: [{ name: "Org" }] },
        { repo: "other/x", filters: [{ name: "Elsewhere" }] },
      ],
    });
    expect(filtersFor(config, "octo/web").map((filter) => filter.name)).toEqual(["Docs", "Web only", "Org"]);
  });

  it("skips repository entries with no name", () => {
    const config = normalize({ repos: [{ repo: "  ", filters: [{ name: "Nameless" }] }] });
    expect(filtersFor(config, "octo/web")).toEqual([]);
  });
});

describe("normalize", () => {
  it("drops malformed entries and fills defaults", () => {
    const config = normalize({ global: [{ name: " Docs " }, null, { include: "x" }], repos: [{ filters: [] }, "x"] });
    expect(config.global).toEqual([{ id: config.global[0]?.id, name: "Docs", include: "", exclude: "" }]);
    expect(typeof config.global[0]?.id).toBe("string");
    expect(config.repos).toEqual([]);
  });

  it('gives every filter a unique id that is never "all"', () => {
    const ids = normalize({
      global: [
        { id: "all", name: "A" },
        { id: "x", name: "B" },
        { id: "x", name: "C" },
      ],
    }).global.map((filter) => filter.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("all");
    expect(ids[1]).toBe("x");
  });

  it("reads patterns that aren't text as empty", () => {
    const config = normalize({ global: [{ id: "x", name: "Docs", include: 3, exclude: null }] });
    expect(config.global).toEqual([{ id: "x", name: "Docs", include: "", exclude: "" }]);
  });

  it("handles empty input", () => {
    expect(normalize()).toEqual({ global: [], repos: [] });
  });
});

describe("REPO_PATTERN", () => {
  it("takes owner/name, nested groups and wildcards, but not a lone name", () => {
    const valid = (repo: string) => ({ repo, valid: REPO_PATTERN.test(repo) });
    for (const repo of ["octo/web", "octo/*", "group/sub/web", "group/sub/*"])
      expect(valid(repo)).toEqual({ repo, valid: true });
    for (const repo of ["web", "octo/", "/web", "octo web/x"]) expect(valid(repo)).toEqual({ repo, valid: false });
  });
});

describe("isEmpty", () => {
  it("is empty with no filters for everywhere and no repositories", () => {
    expect(isEmpty(normalize())).toBe(true);
    expect(isEmpty(normalize({ repos: [{ repo: "octo/web" }] }))).toBe(false);
    expect(isEmpty(normalize({ global: [{ name: "Docs" }] }))).toBe(false);
  });
});
