import { describe, expect, it } from "vitest";
import { buildTree, flatten, foldersOf, inTreeOrder, outlineKey } from "./tree";

const files = ["src/checkout/cart.ts", "src/checkout/promo.ts", "src/app.ts", "README.md", "docs/guide/intro.md", "src/checkout/a10.ts", "src/checkout/a9.ts"].map((path) => ({ path }));

describe("the file tree", () => {
  const tree = buildTree(files);

  it("puts folders first, then files, by name (numbers in order)", () => {
    expect(tree.map((n) => n.name)).toEqual(["docs/guide", "src", "README.md"]);
    const src = tree[1]!;
    expect(src.kind === "folder" && src.children.map((n) => n.name)).toEqual(["checkout", "app.ts"]);
    const checkout = src.kind === "folder" ? src.children[0]! : null;
    expect(checkout?.kind === "folder" && checkout.children.map((n) => n.name)).toEqual(["a9.ts", "a10.ts", "cart.ts", "promo.ts"]);
  });

  it("reads one folder in a folder as one row, keyed by the inner path", () => {
    expect(tree[0]).toMatchObject({ kind: "folder", name: "docs/guide", path: "docs/guide" });
  });

  it("knows every file under a folder", () => {
    const src = tree[1]!;
    expect(src.kind === "folder" && src.files.length).toBe(5);
  });

  it("hides what's in a closed folder", () => {
    expect(flatten(tree, new Set()).length).toBe(10);
    expect(flatten(tree, new Set(["src/checkout"])).map((r) => r.node.name)).toEqual(["docs/guide", "intro.md", "src", "checkout", "app.ts", "README.md"]);
  });

  it("orders the files as the tree shows them", () => {
    expect(inTreeOrder(files).map((f) => f.path)).toEqual(["docs/guide/intro.md", "src/checkout/a9.ts", "src/checkout/a10.ts", "src/checkout/cart.ts", "src/checkout/promo.ts", "src/app.ts", "README.md"]);
  });

  it("names the folders a file is in", () => {
    expect(foldersOf("src/checkout/cart.ts")).toEqual(["src", "src/checkout"]);
    expect(foldersOf("README.md")).toEqual([]);
  });
});

describe("the outline's keys", () => {
  const tree = buildTree(files);
  const closed = new Set(["src/checkout"]);
  const rows = flatten(tree, closed);

  it("moves up and down, to the ends", () => {
    expect(outlineKey(rows, 0, "ArrowDown", closed)).toEqual({ focus: 1 });
    expect(outlineKey(rows, 0, "ArrowUp", closed)).toEqual({ focus: 0 });
    expect(outlineKey(rows, 2, "End", closed)).toEqual({ focus: rows.length - 1 });
  });

  it("opens a closed folder, then goes into it", () => {
    expect(outlineKey(rows, 3, "ArrowRight", closed)).toEqual({ expand: "src/checkout" });
    expect(outlineKey(rows, 2, "ArrowRight", closed)).toEqual({ focus: 3 });
  });

  it("closes an open folder, or goes to the one a row is in", () => {
    expect(outlineKey(rows, 2, "ArrowLeft", closed)).toEqual({ collapse: "src" });
    expect(outlineKey(rows, 4, "ArrowLeft", closed)).toEqual({ focus: 2 });
    expect(outlineKey(rows, 5, "ArrowLeft", closed)).toBeNull();
  });
});
