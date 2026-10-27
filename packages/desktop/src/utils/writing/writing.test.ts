import { describe, expect, it } from "vite-plus/test";

import { complete, emojiList, link, quote, rankEmoji, rankPeople, tokenAt, wrap } from "./writing";

describe("tokenAt", () => {
  it("finds the mention or reference being typed", () => {
    expect(tokenAt("thanks @an", 10)).toEqual({ kind: "mention", query: "an", start: 7 });
    expect(tokenAt("@", 1)).toEqual({ kind: "mention", query: "", start: 0 });
    expect(tokenAt("see (#12", 8)).toEqual({ kind: "reference", query: "12", start: 5 });
  });

  it("ignores email addresses, code and finished words", () => {
    expect(tokenAt("me@example", 10)).toBeNull();
    expect(tokenAt("run `npm @scope", 15)).toBeNull();
    expect(tokenAt("```\n@a", 6)).toBeNull();
    expect(tokenAt("@ana done", 9)).toBeNull();
  });
});

describe("complete", () => {
  it("puts the pick in place with a space after", () => {
    const token = tokenAt("hi @an", 6)!;
    expect(complete("hi @an", token, 6, "ana")).toEqual({ text: "hi @ana ", caret: 8 });
    expect(complete("hi @an and", token, 6, "ana")).toEqual({ text: "hi @ana and", caret: 8 });
  });

  it("puts a reference in with its #", () => {
    expect(complete("see #1", { kind: "reference", query: "1", start: 4 }, 6, "12")).toEqual({
      text: "see #12 ",
      caret: 8,
    });
  });
});

describe("rankPeople", () => {
  const people = [
    { login: "bruno" },
    { login: "carla", name: "Carla Dias" },
    { login: "ana", name: "Ana" },
    { login: "dana" },
    { login: "ana" },
  ];

  it("puts logins that start with it first, then names, then the rest", () => {
    expect(rankPeople(people, "d").map((p) => p.login)).toEqual(["dana", "carla"]);
    expect(rankPeople(people, "an").map((p) => p.login)).toEqual(["ana", "dana"]);
  });

  it("keeps the given order among equally good matches", () => {
    expect(rankPeople([{ login: "zed" }, { login: "zara" }], "z").map((p) => p.login)).toEqual(["zed", "zara"]);
  });

  it("keeps the given order with nothing typed, once each", () => {
    expect(rankPeople(people, "").map((p) => p.login)).toEqual(["bruno", "carla", "ana", "dana"]);
  });
});

describe("wrap", () => {
  it("wraps the selection, or unwraps it", () => {
    expect(wrap("make it bold", 8, 12, "bold")).toEqual({ from: 8, to: 12, insert: "**bold**", select: [10, 14] });
    expect(wrap("**bold**", 0, 8, "bold")).toEqual({ from: 0, to: 8, insert: "bold", select: [0, 4] });
    expect(wrap("**bold**", 2, 6, "bold")).toEqual({ from: 0, to: 8, insert: "bold", select: [0, 4] });
    expect(wrap("x", 1, 1, "code")).toEqual({ from: 1, to: 1, insert: "``", select: [2, 2] });
  });
});

describe("link", () => {
  it("makes the selection a link with the caret on its address", () => {
    expect(link("see docs", 4, 8)).toEqual({ from: 4, to: 8, insert: "[docs]()", select: [11, 11] });
    expect(link("https://x.dev", 0, 13)).toEqual({ from: 0, to: 13, insert: "[](https://x.dev)", select: [1, 1] });
    expect(link("docs", 0, 4, "https://x.dev")).toEqual({
      from: 0,
      to: 4,
      insert: "[docs](https://x.dev)",
      select: [21, 21],
    });
  });
});

describe("quote", () => {
  it("quotes each line", () => {
    expect(quote("a\nb\n")).toBe("> a\n> b\n\n");
  });
});

describe("emoji", () => {
  it("are completed after two letters, not in times or labels", () => {
    expect(tokenAt("nice :ta", 8)).toEqual({ kind: "emoji", query: "ta", start: 5 });
    expect(tokenAt(":+1", 3)).toEqual({ kind: "emoji", query: "+1", start: 0 });
    expect(tokenAt("nice :t", 7)).toBeNull();
    expect(tokenAt("at 10:30", 8)).toBeNull();
    expect(tokenAt("Note:ab", 7)).toBeNull();
  });

  it("go in by name, as GitHub writes them", () => {
    expect(complete("nice :ta", { kind: "emoji", query: "ta", start: 5 }, 8, "tada")).toEqual({
      text: "nice :tada: ",
      caret: 12,
    });
  });

  it("come from GitHub's list as characters, ranked by name", () => {
    const list = emojiList({
      tada: "https://github.githubassets.com/images/icons/emoji/unicode/1f389.png?v8",
      brazil: "https://github.githubassets.com/images/icons/emoji/unicode/1f1e7-1f1f7.png?v8",
      octocat: "https://github.githubassets.com/images/icons/emoji/octocat.png?v8",
      potato: "https://github.githubassets.com/images/icons/emoji/unicode/1f954.png?v8",
    });
    expect(list).toEqual([
      { name: "tada", char: "🎉" },
      { name: "brazil", char: "🇧🇷" },
      { name: "potato", char: "🥔" },
    ]);
    expect(rankEmoji(list, "ta").map((e) => e.name)).toEqual(["tada", "potato"]);
  });

  it("leave out a picture that names no character", () => {
    expect(emojiList({ odd: "https://github.githubassets.com/images/icons/emoji/unicode/ffffff.png" })).toEqual([]);
  });

  it("rank names of the same length alphabetically", () => {
    const list = [
      { name: "tada", char: "🎉" },
      { name: "taco", char: "🌮" },
    ];
    expect(rankEmoji(list, "ta").map((e) => e.name)).toEqual(["taco", "tada"]);
  });
});
