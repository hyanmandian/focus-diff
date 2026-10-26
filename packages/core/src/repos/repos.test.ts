import { describe, expect, it } from "vitest";

import { repoMatches } from "./repos";

describe("repoMatches", () => {
  it("matches exact names and owner wildcards, ignoring case", () => {
    expect(repoMatches("Octo/Web", "octo/web")).toBe(true);
    expect(repoMatches("acme/web", "Acme/Web")).toBe(true);
    expect(repoMatches("octo/*", "octo/api")).toBe(true);
    expect(repoMatches("octo/*", "other/api")).toBe(false);
    expect(repoMatches("acme/*", "acmeinc/api")).toBe(false);
    expect(repoMatches("octo/web", "octo/website")).toBe(false);
  });

  it("ignores spaces around the pattern", () => {
    expect(repoMatches("  octo/web ", "octo/web")).toBe(true);
  });

  it("lets a group's pattern cover its subgroups, on sites that nest them", () => {
    expect(repoMatches("group/*", "group/sub/web")).toBe(true);
  });
});
