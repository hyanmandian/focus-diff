import { afterEach, describe, expect, it, vi } from "vitest";

import { compile, inFilter, isValidPattern, toMatcher } from "./filters";

const match = (filter: { include?: string; exclude?: string }, path: string) =>
  toMatcher({ include: "", exclude: "", ...filter })?.(path);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compile", () => {
  it("has nothing to compile in an empty pattern", () => {
    expect(compile("")).toEqual({ ok: true, regex: null });
  });

  it("says what's wrong with a broken pattern, without the boilerplate", () => {
    const compiled = compile("(");
    expect(compiled.ok).toBe(false);
    expect(compiled.ok ? "" : compiled.error).not.toMatch(/^Invalid regular expression/u);
  });

  it("says what went wrong, whatever was thrown", () => {
    vi.stubGlobal("RegExp", function Broken() {
      // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error -- standing in for an engine that throws something else.
      throw "too complex";
    });
    expect(compile("a")).toEqual({ ok: false, error: "too complex" });
  });

  it("takes patterns the u flag would refuse, as people write them", () => {
    expect(isValidPattern("\\-generated")).toBe(true);
    expect(inFilter({ include: "\\-generated", exclude: "" }, "api-generated.ts")).toBe(true);
  });

  it("tells valid patterns from broken ones", () => {
    expect(isValidPattern("")).toBe(true);
    expect(isValidPattern("\\.md$")).toBe(true);
    expect(isValidPattern("[")).toBe(false);
  });
});

describe("toMatcher", () => {
  it("keeps paths that match include and not exclude", () => {
    const frontend = { include: "\\.(ts|tsx)$", exclude: "\\.(test|stories)\\." };
    expect(match(frontend, "web/src/book-card.tsx")).toBe(true);
    expect(match(frontend, "web/src/book-card.test.tsx")).toBe(false);
    expect(match(frontend, "web/src/book-card.stories.tsx")).toBe(false);
    expect(match(frontend, "api/books/service.py")).toBe(false);
  });

  it("treats an empty include as everything", () => {
    expect(match({ exclude: "\\.md$" }, "src/index.ts")).toBe(true);
    expect(match({ exclude: "\\.md$" }, "README.md")).toBe(false);
  });

  it("ignores case", () => {
    expect(match({ include: "readme" }, "README.md")).toBe(true);
  });

  it("returns null for broken patterns", () => {
    expect(toMatcher({ include: "(", exclude: "" })).toBeNull();
    expect(toMatcher({ include: "", exclude: "(" })).toBeNull();
  });
});

describe("inFilter", () => {
  const frontend = { include: "\\.tsx?$", exclude: "\\.test\\." };

  it("keeps the files a filter includes and doesn't exclude, ignoring case", () => {
    expect(inFilter(frontend, "src/App.TSX")).toBe(true);
    expect(inFilter(frontend, "src/app.test.tsx")).toBe(false);
    expect(inFilter(frontend, "README.md")).toBe(false);
    expect(inFilter({ include: "", exclude: "" }, "anything.go")).toBe(true);
  });

  it("leaves every file in when the include is broken, and nothing out when the exclude is", () => {
    expect(inFilter({ include: "(", exclude: "\\.md$" }, "README.md")).toBe(true);
    expect(inFilter({ include: "\\.md$", exclude: "(" }, "README.md")).toBe(true);
    expect(inFilter({ include: "\\.md$", exclude: "(" }, "app.ts")).toBe(false);
  });
});
