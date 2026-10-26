import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ImageDiff, isImage, NoPatchFile, renamed } from "@/components/rich-diff/rich-diff";
import type { Source } from "@/utils/contents/contents";
import { later, renderTwice } from "@/utils/mock-render/mock-render";
import type { ReviewFile } from "@/utils/review/review";

/** A command's named argument, as the page sent it. */
const arg = (args: InvokeArgs | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

type Stored = Record<string, number | "absent" | Error>;

/** Files at commits, by "sha:path": their size in bytes, absent, or a failure. Records what's asked. */
function commits(stored: Stored) {
  const asked: string[] = [];
  mockIPC((_, args) => {
    const key = `${String(arg(args, "sha"))}:${String(arg(args, "path"))}`;
    asked.push(key);
    const found = stored[key] ?? "absent";
    if (typeof found === "number") return new Uint8Array(found);
    // Rust's errors arrive as they're thrown; a missing file as "absent".
    // oxlint-disable-next-line typescript/only-throw-error -- Rust says a file is missing with that string.
    throw found;
  });
  return asked;
}

let made = 0;
let created = vi.fn<(object: Blob | MediaSource) => string>();
let revoked = vi.fn<(url: string) => void>();
beforeEach(() => {
  created = vi.fn<(object: Blob | MediaSource) => string>(() => `blob:picture-${++made}`);
  revoked = vi.fn<(url: string) => void>();
  vi.spyOn(URL, "createObjectURL").mockImplementation(created);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoked);
});

// Rust's errors reach the page as plain strings.
// oxlint-disable-next-line prefer-promise-reject-errors, typescript/prefer-promise-reject-errors -- the case under test.
const noBase = () => Promise.reject("no base");

let unique = 0;
/** A picture file, with a path no other test has used (fileAt remembers what it read). */
const picture = (extra: Partial<ReviewFile> = {}, name = `shot${++unique}.png`): ReviewFile => ({
  path: `img/${name}`,
  previousPath: null,
  status: "modified",
  additions: 0,
  deletions: 0,
  patch: "",
  ...extra,
});

const source = (base: () => Promise<string> = () => Promise.resolve("base")): Source => ({
  repo: "acme/shop",
  head: "head",
  base,
});

const images = () => screen.queryAllByRole("img").map((img) => img.getAttribute("alt"));

describe("isImage", () => {
  it("knows pictures by their extension", () => {
    expect(isImage("a/b.PNG")).toBe(true);
    expect(isImage("icon.svg")).toBe(true);
    expect(isImage("notes.txt")).toBe(false);
    expect(isImage("Makefile")).toBe(false);
  });
});

describe("renamed", () => {
  it("says what a renamed file was called", () => {
    expect(renamed({ path: "a/b.ts", previousPath: null })).toBeNull();
    expect(renamed({ path: "a/b.ts", previousPath: "a/b.ts" })).toBeNull();
    expect(renamed({ path: "a/new.ts", previousPath: "a/old.ts" })).toBe("old.ts");
    expect(renamed({ path: "b/new.ts", previousPath: "a/old.ts" })).toBe("a/old.ts");
    expect(renamed({ path: "b/new.ts", previousPath: "a/old.ts" }, true)).toBe("old.ts");
    expect(renamed({ path: "b/same.ts", previousPath: "a/same.ts" }, true)).toBe("a/same.ts");
  });
});

describe("ImageDiff", () => {
  it("shows the two versions side by side, with their sizes", async () => {
    const file = picture();
    const asked = commits({ [`base:${file.path}`]: 500, [`head:${file.path}`]: 2048 });
    const s = source();
    const { again } = renderTwice(() => <ImageDiff file={file} source={s} />);
    expect(screen.getByRole("status").textContent).toContain("Loading…");
    await screen.findByRole("group", { name: "Compare" });
    again();
    expect(images()).toEqual(["Before", "After"]);
    expect(screen.getByRole("img", { name: "Before" }).getAttribute("src")).toMatch(/^blob:/u);
    expect(screen.getByText("500 B")).toBeTruthy();
    const after = screen.getByRole("img", { name: "After" });
    Object.defineProperties(after, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
    fireEvent.load(after);
    fireEvent.load(after);
    expect(screen.getByText("640 × 480 · 2.0 KB")).toBeTruthy();
    expect(asked.toSorted()).toEqual([`base:${file.path}`, `head:${file.path}`]);
  });

  it("swipes between them or fades one over the other, and remembers how", async () => {
    const file = picture({ status: "renamed", previousPath: "img/old.png" });
    commits({ "base:img/old.png": 3 * 1024 * 1024, [`head:${file.path}`]: 10 });
    renderTwice(() => <ImageDiff file={file} source={source()} />);
    expect(await screen.findByText("3.0 MB")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Swipe" }));
    const slider = screen.getByRole("slider", { name: "Where the swipe is" });
    fireEvent.change(slider, { target: { value: "30" } });
    expect(screen.getByRole("img", { name: "After" }).style.clipPath).toBe("inset(0 0 0 30%)");
    expect(localStorage.getItem("image-diff-mode")).toBe("swipe");
    await userEvent.click(screen.getByRole("button", { name: "Onion Skin" }));
    expect(screen.getByRole("img", { name: "After" }).style.opacity).toBe("0.3");
    expect(screen.getByRole("slider", { name: "How much of the new one shows" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Onion Skin" }));
    expect(screen.getByRole("button", { name: "Onion Skin" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("starts the way chosen last", async () => {
    localStorage.setItem("image-diff-mode", "onion");
    const file = picture();
    commits({ [`base:${file.path}`]: 1, [`head:${file.path}`]: 1 });
    renderTwice(() => <ImageDiff file={file} source={source()} />);
    expect(await screen.findByRole("slider", { name: "How much of the new one shows" })).toBeTruthy();
  });

  it("still works where storage is refused", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const file = picture();
    commits({ [`base:${file.path}`]: 1, [`head:${file.path}`]: 1 });
    renderTwice(() => <ImageDiff file={file} source={source()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Swipe" }));
    expect(screen.getByRole("slider", { name: "Where the swipe is" })).toBeTruthy();
  });

  it("shows an added picture alone, and a deleted one as it was", async () => {
    const added = picture({ status: "added" });
    const removed = picture({ status: "removed", previousPath: "img/gone-before.png" });
    const asked = commits({ [`head:${added.path}`]: 4, "base:img/gone-before.png": 4 });
    renderTwice(() => <ImageDiff file={added} source={source()} />);
    expect(await screen.findByRole("img", { name: "Added" })).toBeTruthy();
    renderTwice(() => <ImageDiff file={removed} source={source()} />);
    expect(await screen.findByRole("img", { name: "Deleted" })).toBeTruthy();
    expect(asked).toEqual([`head:${added.path}`, "base:img/gone-before.png"]);
  });

  it("shows nothing when neither version is there, or there's nowhere to look", async () => {
    const file = picture();
    commits({});
    const { container } = renderTwice(() => <ImageDiff file={file} source={source()} />);
    await waitFor(() => {
      expect(container.textContent).toBe("");
    });
    const { container: nowhere } = renderTwice(() => <ImageDiff file={file} source={null} />);
    expect(nowhere.textContent).toBe("");
  });

  it("says why a version couldn't load", async () => {
    const first = picture();
    const second = picture();
    commits({
      [`base:${first.path}`]: new Error("Bad credentials"),
      [`head:${first.path}`]: 1,
      [`base:${second.path}`]: 1,
      [`head:${second.path}`]: new Error("Not found"),
    });
    const s = source();
    const { again } = renderTwice(() => <ImageDiff file={first} source={s} />);
    expect(await screen.findByText("Couldn't load it: Bad credentials")).toBeTruthy();
    again();
    const next = renderTwice(() => <ImageDiff file={second} source={s} />);
    expect(await screen.findByText("Couldn't load it: Not found")).toBeTruthy();
    next.again();
  });

  it("says why when the failure isn't an Error", async () => {
    const file = picture();
    commits({ [`head:${file.path}`]: 1 });
    renderTwice(() => <ImageDiff file={file} source={source(noBase)} />);
    expect(await screen.findByText("Couldn't load it: no base")).toBeTruthy();
  });

  it("loads again for another file, and lets go of what it showed", async () => {
    const one = picture({ status: "added" });
    const two = picture({ status: "added" });
    commits({ [`head:${one.path}`]: 1, [`head:${two.path}`]: 2 });
    const s = source();
    const { rerender, unmount } = renderTwice(() => <ImageDiff file={one} source={s} />);
    await screen.findByText("1 B");
    rerender(<ImageDiff file={two} source={s} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(await screen.findByText("2 B")).toBeTruthy();
    unmount();
    expect(revoked).toHaveBeenCalledTimes(2);
  });

  it("drops what arrives after it's gone", async () => {
    const held = later();
    const failing = later();
    const file = picture();
    commits({ [`base:${file.path}`]: 1, [`head:${file.path}`]: 1 });
    const slow = () => held.promise.then(() => "base");
    const broken = () =>
      failing.promise.then(() => {
        throw new Error("late");
      });
    renderTwice(() => <ImageDiff file={file} source={source(slow)} />).unmount();
    renderTwice(() => <ImageDiff file={file} source={source(broken)} />).unmount();
    held.settle();
    failing.settle();
    await held.promise;
    await failing.promise;
    expect(created).not.toHaveBeenCalled();
  });
});

describe("NoPatchFile", () => {
  type Props = Parameters<typeof NoPatchFile>[0];
  const onViewed = vi.fn<(viewed: boolean) => void>();
  const onLoad = vi.fn<() => void>();

  function card(extra: Partial<Props> = {}) {
    const props: Props = {
      file: picture({ path: "dist/bundle.js" }),
      source: source(),
      viewed: false,
      loading: false,
      error: null,
      onViewed,
      onLoad,
      ...extra,
    };
    return renderTwice(() => <NoPatchFile {...props} />);
  }

  it("offers to load a diff too large for GitHub's", async () => {
    card();
    expect(screen.getByRole("region", { name: "dist/bundle.js" })).toBeTruthy();
    expect(screen.getByText("Not shown: too large for GitHub's diff, or binary.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Load Diff" }));
    expect(onLoad).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Viewed dist/bundle.js" }));
    expect(onViewed).toHaveBeenCalledWith(true, expect.anything());
  });

  it("shows it loading, or why it couldn't, or nothing to load from", () => {
    card({ loading: true, viewed: true });
    expect(screen.getByRole("button", { name: "Load Diff" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    card({ error: "Too big even so" });
    expect(screen.getByText("Too big even so")).toBeTruthy();
    card({ source: null });
    expect(screen.getAllByRole("button", { name: "Load Diff" })).toHaveLength(1);
  });

  it("says a file was only renamed", () => {
    card({ file: { ...picture(), path: "src/new.ts", previousPath: "src/old.ts", status: "renamed" } });
    expect(screen.getByText("Renamed without changes.")).toBeTruthy();
    expect(screen.getByTitle("src/old.ts → src/new.ts").textContent).toBe("old.ts → src/new.ts");
  });

  it("compares a picture", async () => {
    const file = picture({ status: "added" });
    commits({ [`head:${file.path}`]: 1 });
    card({ file, additions: 1 } as Partial<Props>);
    expect(await screen.findByRole("img", { name: "Added" })).toBeTruthy();
  });
});
