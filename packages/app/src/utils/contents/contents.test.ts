import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "../fake-platform/fake-platform";
import type { Args } from "../platform/platform";
import { BinaryFile, bothVersions, fileAt, isBinary, mergeBase, textAt, type Source } from "./contents";

const field = (args: Args | undefined, key: string): unknown =>
  args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)
    ? args[key]
    : undefined;

const bytes = (text: string) => new TextEncoder().encode(text);

/** Rust's file store: `files` by "sha:path"; a missing one is "absent", and `failing` paths fail. */
function store(files: Record<string, Uint8Array | ArrayBuffer>, failing: string[] = []) {
  const asked: string[] = [];
  mockCommands((cmd, args) => {
    if (cmd !== "github_file") return null;
    const key = `${String(field(args, "sha"))}:${String(field(args, "path"))}`;
    asked.push(`${String(field(args, "repo"))} ${key}`);
    if (failing.includes(key)) throw new Error("offline");
    const file = files[key];
    // Rust's errors arrive as plain strings; "absent" is its word for a file that isn't there.
    // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error
    if (!file) throw "absent";
    return file;
  });
  return asked;
}

describe("fileAt", () => {
  it("fetches a file's bytes once per commit and path", async () => {
    const asked = store({ "s1:a.txt": bytes("hello") });
    expect(await fileAt("acme/shop", "s1", "a.txt")).toEqual(bytes("hello"));
    await fileAt("acme/shop", "s1", "a.txt");
    expect(asked).toEqual(["acme/shop s1:a.txt"]);
  });

  it("takes the bytes as an ArrayBuffer too", async () => {
    store({ "s2:a.txt": bytes("hi").buffer });
    expect(await fileAt("acme/shop", "s2", "a.txt")).toEqual(bytes("hi"));
  });

  it("is null for a file that isn't at that commit", async () => {
    store({});
    await expect(fileAt("acme/shop", "s3", "gone.txt")).resolves.toBeNull();
  });

  it("fails, and tries again next time, when it couldn't be fetched", async () => {
    const asked = store({}, ["s4:a.txt"]);
    await expect(fileAt("acme/shop", "s4", "a.txt")).rejects.toThrow("offline");
    store({ "s4:a.txt": bytes("back") });
    expect(await fileAt("acme/shop", "s4", "a.txt")).toEqual(bytes("back"));
    expect(asked).toHaveLength(1);
  });

  it("turns a failure that isn't an Error into one", async () => {
    mockCommands(() => {
      // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error -- as Rust's errors come
      throw "network down";
    });
    await expect(fileAt("acme/shop", "s5", "a.txt")).rejects.toThrow(new Error("network down"));
  });
});

describe("isBinary", () => {
  it("is binary with a zero byte in the first 8,000, as git decides", () => {
    expect(isBinary(bytes("plain text"))).toBe(false);
    expect(isBinary(new Uint8Array([65, 0, 66]))).toBe(true);
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(isBinary(late)).toBe(false);
  });
});

describe("textAt", () => {
  it("reads a file as text, null when it isn't there, and refuses binary files", async () => {
    store({ "t1:a.txt": bytes("olá"), "t1:img.png": new Uint8Array([137, 80, 0, 1]) });
    await expect(textAt("acme/shop", "t1", "a.txt")).resolves.toBe("olá");
    await expect(textAt("acme/shop", "t1", "none.txt")).resolves.toBeNull();
    await expect(textAt("acme/shop", "t1", "img.png")).rejects.toBeInstanceOf(BinaryFile);
  });
});

/** GitHub's pull request and compare answers; `fail` fails the compare. */
function githubPulls(fail = false) {
  const asked: string[] = [];
  mockCommands((_cmd, args) => {
    const path = String(field(args, "path"));
    asked.push(path);
    if (path.includes("/compare/"))
      return fail
        ? { status: 500, body: JSON.stringify({ message: "boom" }) }
        : { status: 200, body: JSON.stringify({ merge_base_commit: { sha: "base-sha" } }) };
    return { status: 200, body: JSON.stringify({ base: { sha: "tip" } }) };
  });
  return asked;
}

describe("mergeBase", () => {
  const ref = { owner: "acme", repo: "shop", number: 7 };

  it("asks GitHub for the commit the head branched from, once per head", async () => {
    const asked = githubPulls();
    await expect(mergeBase(ref, "h1")).resolves.toBe("base-sha");
    await expect(mergeBase(ref, "h1")).resolves.toBe("base-sha");
    expect(asked).toEqual(["/repos/acme/shop/pulls/7", "/repos/acme/shop/compare/tip...h1?per_page=1"]);
  });

  it("asks again after a failure", async () => {
    const failed = githubPulls(true);
    await expect(mergeBase(ref, "h2")).rejects.toThrow("boom");
    expect(failed).toHaveLength(2);
    const asked = githubPulls();
    await expect(mergeBase(ref, "h2")).resolves.toBe("base-sha");
    expect(asked).toHaveLength(2);
  });
});

describe("bothVersions", () => {
  const source: Source = { repo: "acme/shop", head: "v-head", base: () => Promise.resolve("v-base") };

  it("reads the old version at the merge base and the new at the head", async () => {
    store({ "v-base:a.ts": bytes("old"), "v-head:a.ts": bytes("new") });
    await expect(bothVersions(source, { path: "a.ts", previousPath: null, status: "modified" })).resolves.toEqual({
      oldText: "old",
      newText: "new",
    });
  });

  it("reads a renamed file's old version under its old name", async () => {
    store({ "v-base:old.ts": bytes("before"), "v-head:new.ts": bytes("after") });
    await expect(bothVersions(source, { path: "new.ts", previousPath: "old.ts", status: "renamed" })).resolves.toEqual({
      oldText: "before",
      newText: "after",
    });
  });

  it("has no old side for an added file and no new side for a removed one", async () => {
    const asked = store({ "v-head:added.ts": bytes("fresh"), "v-base:removed.ts": bytes("stale") });
    await expect(bothVersions(source, { path: "added.ts", previousPath: null, status: "added" })).resolves.toEqual({
      oldText: null,
      newText: "fresh",
    });
    await expect(bothVersions(source, { path: "removed.ts", previousPath: null, status: "removed" })).resolves.toEqual({
      oldText: "stale",
      newText: null,
    });
    expect(asked).toEqual(["acme/shop v-head:added.ts", "acme/shop v-base:removed.ts"]);
  });
});
