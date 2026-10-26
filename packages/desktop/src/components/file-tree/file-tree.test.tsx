import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FileTree } from "@/components/file-tree/file-tree";
import type { ReviewFile } from "@/utils/review/review";

const file = (path: string, extra: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 3,
  deletions: 1,
  patch: "",
  ...extra,
});

const FILES = [
  file("src/cart/cart.ts"),
  file("src/cart/total.ts", { previousPath: "src/cart/sum.ts", status: "renamed" }),
  file("src/app.ts"),
  file("docs/guide/intro.md"),
  file("README.md"),
];

const VIEWED = new Set(["src/cart/cart.ts", "docs/guide/intro.md"]);
const isViewed = (f: ReviewFile) => VIEWED.has(f.path);
const TALK: Record<string, number> = { "src/cart/cart.ts": 2, "src/app.ts": 1 };
const comments = (path: string) => TALK[path] ?? 0;

type Options = { files?: ReviewFile[] | null; flat?: boolean; picked?: string | null };

function tree({ files = FILES, flat = false, picked = null }: Options = {}) {
  const onPick = vi.fn<(path: string) => void>();
  const view = (shown: Options = {}) => (
    <FileTree
      files={shown.files === undefined ? files : shown.files}
      flat={shown.flat ?? flat}
      picked={shown.picked === undefined ? picked : shown.picked}
      isViewed={isViewed}
      comments={comments}
      onPick={onPick}
    />
  );
  const result = render(view());
  return {
    onPick,
    container: result.container,
    rerender: (shown: Options) => {
      result.rerender(view(shown));
    },
  };
}

const rows = () => screen.queryAllByRole("treeitem").map((r) => r.textContent);
const row = (name: string | RegExp) => screen.getByRole("treeitem", { name });
const outline = () => screen.getByRole("tree", { name: "Files" });
const selected = () => screen.queryAllByRole("treeitem").find((r) => r.getAttribute("aria-selected") === "true");

/** ResizeObserver, told by the test when sizes change. */
function watchSizes() {
  const callbacks: Array<() => void> = [];
  const observed: Element[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    },
  );
  return {
    observed,
    all: () => {
      for (const callback of callbacks) callback();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileTree", () => {
  it("watches the list's height once the files have loaded", () => {
    const sizes = watchSizes();
    const { rerender } = tree({ files: null });
    expect(sizes.observed).toHaveLength(0);
    rerender({ files: FILES });
    expect(sizes.observed).toHaveLength(1);
  });

  it("shows placeholders while the files load", () => {
    tree({ files: null, flat: true });
    const { container } = tree({ files: null });
    expect(container.querySelector("[aria-busy]")?.children).toHaveLength(6);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("shows the files as folders, with what's viewed and talked about", () => {
    tree();
    // Each file's icon reads as its kind ("TS", "MD").
    expect(rows()).toEqual([
      "docs/guide1/1",
      "MDintro.md+3 −1",
      "src31/3",
      "cart21/2",
      "TScart.ts2+3 −1",
      "TSsum.ts\u00A0→\u00A0total.ts+3 −1",
      "TSapp.ts1+3 −1",
      "MDREADME.md+3 −1",
    ]);
    expect(screen.getByLabelText("3 open conversations")).toBeTruthy();
    expect(screen.getByLabelText("1 open conversation")).toBeTruthy();
    expect(row(/^docs/u).getAttribute("aria-expanded")).toBe("true");
    expect(row(/^docs/u).className).toContain("text-muted-foreground");
    expect(row(/^README/u).getAttribute("aria-level")).toBe("1");
    expect(row(/^intro/u).getAttribute("aria-level")).toBe("2");
    expect(row(/total\.ts/u).title).toBe("src/cart/sum.ts → src/cart/total.ts");
    expect(row(/^README/u).title).toBe("README.md");
    expect(screen.getByLabelText("1 of 3 viewed")).toBeTruthy();
  });

  it("closes and opens a folder when clicked, and picks a file", async () => {
    const { onPick } = tree();
    await userEvent.click(row(/^src/u));
    expect(row(/^src/u).getAttribute("aria-expanded")).toBe("false");
    expect(rows()).toEqual(["docs/guide1/1", "MDintro.md+3 −1", "src31/3", "MDREADME.md+3 −1"]);
    await userEvent.click(row(/^src/u));
    await userEvent.click(row(/^app\.ts/u));
    expect(onPick).toHaveBeenCalledWith("src/app.ts");
    expect(selected()).toBe(row(/^app\.ts/u));
    expect(document.activeElement).toBe(outline());
    expect(outline().getAttribute("aria-activedescendant")).toBe(row(/^app\.ts/u).id);
  });

  it("moves through the outline from the keyboard, as the Finder's list does", async () => {
    const { onPick } = tree();
    await userEvent.tab();
    expect(selected()).toBe(row(/^docs/u));
    await userEvent.keyboard("{ArrowDown}");
    expect(onPick).toHaveBeenLastCalledWith("docs/guide/intro.md");
    await userEvent.keyboard("{ArrowDown}");
    expect(onPick).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{ArrowLeft}");
    expect(row(/^src/u).getAttribute("aria-expanded")).toBe("false");
    await userEvent.keyboard("{ArrowRight}");
    expect(row(/^src/u).getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(row(/^src/u).getAttribute("aria-expanded")).toBe("false");
    await userEvent.keyboard(" ");
    expect(row(/^src/u).getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{End}{Enter}");
    expect(onPick).toHaveBeenLastCalledWith("README.md");
    await userEvent.keyboard("x");
    expect(selected()).toBe(row(/^README/u));
  });

  it("keeps the row selected when the list is focused again", async () => {
    tree();
    await userEvent.click(row(/^app\.ts/u));
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(selected()).toBe(row(/^app\.ts/u));
  });

  it("ignores Return with nothing selected, and keys in an empty list", async () => {
    const { onPick } = tree({ files: [] });
    fireEvent.keyDown(outline(), { key: "Enter" });
    fireEvent.keyDown(outline(), { key: "ArrowDown" });
    await userEvent.click(outline());
    expect(onPick).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it("lists paths flat while searching, with the folders dimmed", async () => {
    const { onPick } = tree({ flat: true });
    expect(rows()).toEqual([
      "TSsrc/cart/cart.ts2+3 −1",
      "TSsum.ts\u00A0→\u00A0src/cart/total.ts+3 −1",
      "TSsrc/app.ts1+3 −1",
      "MDdocs/guide/intro.md+3 −1",
      "MDREADME.md+3 −1",
    ]);
    expect(screen.getByText("src/").className).toContain("text-muted-foreground");
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowLeft}");
    expect(onPick).toHaveBeenCalledWith("src/cart/total.ts");
  });

  it("shows a renamed file's whole old path when it moved and kept its name", () => {
    tree({
      files: [file("lib/total.ts", { previousPath: "src/total.ts" }), file("lib/a.ts", { previousPath: "lib/a.ts" })],
    });
    expect(rows()).toEqual(["lib0/2", "TSa.ts+3 −1", "TSsrc/total.ts\u00A0→\u00A0total.ts+3 −1"]);
  });

  it("opens the folders of a file picked elsewhere, and selects it", async () => {
    const { rerender } = tree();
    await userEvent.click(row(/^src/u));
    rerender({ picked: "src/cart/total.ts" });
    expect(selected()).toBe(row(/total\.ts/u));
    rerender({ picked: "README.md" });
    expect(selected()).toBe(row(/^README/u));
    rerender({ picked: null });
    expect(selected()).toBe(row(/^README/u));
  });

  it("scrolls the selected row into view, and draws only the rows on screen", () => {
    const resized = watchSizes();
    const many = Array.from({ length: 200 }, (_, i) => file(`f${String(i).padStart(3, "0")}.ts`));
    const { rerender } = tree({ files: many, picked: "f000.ts" });
    const list = outline();
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 240 });
    act(() => {
      resized.all();
    });
    expect(rows()).toHaveLength(18);
    rerender({ picked: "f150.ts" });
    expect(list.scrollTop).toBe(151 * 24 - 240);
    fireEvent.scroll(list);
    expect(rows()[0]).toContain("f133.ts");
    rerender({ picked: "f140.ts" });
    expect(list.scrollTop).toBe(140 * 24);
    rerender({ picked: "f145.ts" });
    expect(list.scrollTop).toBe(140 * 24);
  });
});
