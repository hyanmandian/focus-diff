type TreeFolder<F> = { kind: "folder"; path: string; name: string; children: Array<TreeNode<F>>; files: F[] };
type TreeLeaf<F> = { kind: "file"; path: string; name: string; file: F };
export type TreeNode<F> = TreeFolder<F> | TreeLeaf<F>;

export type TreeRow<F> = { node: TreeNode<F>; depth: number; parent: string | null };

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function alone<F>(folder: TreeFolder<F>): TreeFolder<F> | null {
  if (folder.path === "" || folder.children.length !== 1) return null;
  const only = folder.children[0]!;
  return only.kind === "folder" ? only : null;
}

export function buildTree<F extends { path: string }>(files: F[]): Array<TreeNode<F>> {
  const root: TreeFolder<F> = { kind: "folder", path: "", name: "", children: [], files: [] };
  const folders = new Map<string, TreeFolder<F>>([["", root]]);
  for (const file of files) {
    const parts = file.path.split("/");
    let parent = root;
    root.files.push(file);
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let folder = folders.get(path);
      if (!folder) {
        folder = { kind: "folder", path, name: parts[i]!, children: [], files: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }
      folder.files.push(file);
      parent = folder;
    }
    parent.children.push({ kind: "file", path: file.path, name: parts.at(-1)!, file });
  }
  const tidy = (folder: TreeFolder<F>): TreeFolder<F> => {
    let f = folder;
    for (let only = alone(f); only; only = alone(f)) f = { ...only, name: `${f.name}/${only.name}` };
    f.children = f.children
      .map((c) => (c.kind === "folder" ? tidy(c) : c))
      .toSorted((a, b) => (a.kind === b.kind ? byName(a.name, b.name) : a.kind === "folder" ? -1 : 1));
    return f;
  };
  return tidy(root).children;
}

export function flatten<F>(
  nodes: Array<TreeNode<F>>,
  collapsed: ReadonlySet<string>,
  depth = 0,
  parent: string | null = null,
): Array<TreeRow<F>> {
  const rows: Array<TreeRow<F>> = [];
  for (const node of nodes) {
    rows.push({ node, depth, parent });
    if (node.kind === "folder" && !collapsed.has(node.path))
      rows.push(...flatten(node.children, collapsed, depth + 1, node.path));
  }
  return rows;
}

export function inTreeOrder<F extends { path: string }>(files: F[]): F[] {
  const out: F[] = [];
  const walk = (nodes: Array<TreeNode<F>>) => {
    for (const node of nodes) {
      if (node.kind === "file") out.push(node.file);
      else walk(node.children);
    }
  };
  walk(buildTree(files));
  return out;
}

export function foldersOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

type OutlineAction = { focus: number } | { expand: string } | { collapse: string } | null;

export function outlineKey<F>(
  rows: Array<TreeRow<F>>,
  at: number,
  key: string,
  collapsed: ReadonlySet<string>,
): OutlineAction {
  const row = rows[at];
  if (rows.length === 0) return null;
  if (!row) return { focus: 0 };
  switch (key) {
    case "ArrowDown":
      return { focus: Math.min(rows.length - 1, at + 1) };
    case "ArrowUp":
      return { focus: Math.max(0, at - 1) };
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: rows.length - 1 };
    case "ArrowRight":
      if (row.node.kind !== "folder") return null;
      return collapsed.has(row.node.path)
        ? { expand: row.node.path }
        : at + 1 < rows.length && rows[at + 1]!.depth > row.depth
          ? { focus: at + 1 }
          : null;
    case "ArrowLeft": {
      if (row.node.kind === "folder" && !collapsed.has(row.node.path)) return { collapse: row.node.path };
      const up = rows.findIndex((r) => r.node.kind === "folder" && r.node.path === row.parent);
      return up >= 0 ? { focus: up } : null;
    }
    default:
      return null;
  }
}
