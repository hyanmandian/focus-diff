import { describe, expect, it } from "vitest";

import { ENGLISH, PORTUGUESE, type Words } from "./queue-words";

/** Every word, each function given strings for its arguments (numbers read the same in a template). */
const said = (words: Words): string[] =>
  Object.values(words).map((word: string | ((...args: never[]) => string)) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- each word takes at most three arguments, and makes a string of them.
    typeof word === "string" ? word : (word as (a: string, b: string, c: string) => string)("A", "B", "C"),
  );

describe("the engine's words", () => {
  it("are all there in both languages, and differ", () => {
    expect(Object.keys(PORTUGUESE)).toStrictEqual(Object.keys(ENGLISH));
    const english = said(ENGLISH);
    const portuguese = said(PORTUGUESE);
    for (const [i, word] of english.entries()) {
      expect(word).not.toBe("");
      expect(portuguese[i]).not.toBe(word);
    }
  });

  it("say errors as watch.rs and github.rs do", () => {
    expect(ENGLISH.slowDown(5)).toBe("GitHub asked Focus Diff to slow down: trying again in 5 minutes");
    expect(PORTUGUESE.githubReturned(502)).toBe("O GitHub respondeu 502");
    expect(ENGLISH.unsupportedPattern("Web", "(?=x)")).toBe('Web: the file pattern "(?=x)" isn\'t supported');
    expect(PORTUGUESE.moreUpdates(3)).toBe("Mais 3 atualizações nos seus pull requests");
  });
});
