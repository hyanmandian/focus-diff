import { describe, expect, it, vi } from "vitest";

import { ABSENT, BUDGET, createBlobs, encode, MOST_ABSENT, validPath, validRepo, validSha } from "./blobs";

const SHA = "a".repeat(40);
const bytes = (text: string) => new TextEncoder().encode(text);

describe("files at a commit", () => {
  it("take only safe requests", () => {
    expect(validRepo("acme/web.site")).toBe(true);
    expect(validRepo("acme/../x")).toBe(false);
    expect(validRepo("acme")).toBe(false);
    expect(validRepo("acme/")).toBe(false);
    expect(validSha(SHA)).toBe(true);
    expect(validSha("b".repeat(64))).toBe(true);
    expect(validSha("main")).toBe(false);
    expect(validSha("z".repeat(40))).toBe(false);
    expect(validPath("src/a b.ts")).toBe(true);
    for (const bad of ["../etc/passwd", "/abs", "a//b", "a/./b", "", "a\\b", "a\0b", "x".repeat(4097)])
      expect(validPath(bad)).toBe(false);
  });

  it("encode paths for the API", () => {
    expect(encode("src/a b#?.ts")).toBe("src/a%20b%23%3F.ts");
    expect(encode("é")).toBe("%C3%A9");
    expect(encode("a~_-.z/0")).toBe("a~_-.z/0");
  });

  it("are fetched raw once, then kept", async () => {
    const api = {
      bytes: vi.fn<() => Promise<{ status: number; bytes: Uint8Array }>>(() =>
        Promise.resolve({ status: 200, bytes: bytes("hello") }),
      ),
    };
    const fileAt = createBlobs(api);
    await expect(fileAt("acme/web", SHA, "src/a b.ts")).resolves.toEqual(bytes("hello"));
    await expect(fileAt("acme/web", SHA, "src/a b.ts")).resolves.toEqual(bytes("hello"));
    expect(api.bytes).toHaveBeenCalledTimes(1);
    expect(api.bytes).toHaveBeenCalledWith(
      `/repos/acme/web/contents/src/a%20b.ts?ref=${SHA}`,
      "application/vnd.github.raw+json",
      20 * 1024 * 1024,
    );
    await expect(fileAt("acme", SHA, "a")).rejects.toThrow("Bad request");
  });

  it("say when a file isn't there, and remember it", async () => {
    const api = {
      bytes: vi.fn<() => Promise<{ status: number; bytes: Uint8Array }>>(() =>
        Promise.resolve({ status: 404, bytes: new Uint8Array() }),
      ),
    };
    const fileAt = createBlobs(api);
    await expect(fileAt("acme/web", SHA, "gone.ts")).rejects.toThrow(ABSENT);
    await expect(fileAt("acme/web", SHA, "gone.ts")).rejects.toThrow(ABSENT);
    expect(api.bytes).toHaveBeenCalledTimes(1);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
    for (let i = 0; i <= MOST_ABSENT; i++) await fileAt("acme/web", SHA, `f${i}`).catch(() => null);
    await fileAt("acme/web", SHA, "gone.ts").catch(() => null);
    expect(api.bytes).toHaveBeenCalledTimes(MOST_ABSENT + 3);
  });

  it("say what GitHub said otherwise, and ask again next time", async () => {
    const api = {
      bytes: vi.fn<() => Promise<{ status: number; bytes: Uint8Array }>>(() =>
        Promise.resolve({ status: 500, bytes: new Uint8Array() }),
      ),
    };
    const fileAt = createBlobs(api);
    await expect(fileAt("acme/web", SHA, "a")).rejects.toThrow("GitHub returned 500");
    await expect(fileAt("acme/web", SHA, "a")).rejects.toThrow("GitHub returned 500");
    expect(api.bytes).toHaveBeenCalledTimes(2);
  });

  it("let the least recently used go past the budget", async () => {
    const big = new Uint8Array(BUDGET / 2);
    const api = {
      bytes: vi.fn<() => Promise<{ status: number; bytes: Uint8Array }>>(() =>
        Promise.resolve({ status: 200, bytes: big }),
      ),
    };
    const fileAt = createBlobs(api);
    await fileAt("acme/web", SHA, "a");
    await fileAt("acme/web", SHA, "b");
    await fileAt("acme/web", SHA, "a");
    await fileAt("acme/web", SHA, "c");
    await fileAt("acme/web", SHA, "a");
    expect(api.bytes).toHaveBeenCalledTimes(3);
    await fileAt("acme/web", SHA, "b");
    expect(api.bytes).toHaveBeenCalledTimes(4);
  });
});
