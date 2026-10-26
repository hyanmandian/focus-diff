// The Diff's sidebar: the files as an outline of folders, like the Finder's list view, or as a flat
// list of paths while searching. Folders open and close (a click on the disclosure triangle, or ←
// and → from the keyboard) and say how many of their files are viewed and how many conversations
// are open in them. Only the rows on screen are drawn, so a pull request of thousands of files
// scrolls as smoothly as one of ten.

import { ChevronRight, Folder } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n";
import type { ReviewFile } from "@/lib/review";
import { buildTree, flatten, foldersOf, outlineKey, type TreeRow } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcon";
import { renamed } from "./RichDiff";

/** --row-h-sm: every row the same height, so where each one is needs no measuring. */
const ROW = 24;
/** Rows drawn past each edge, so a fast scroll doesn't show them missing. */
const OVERSCAN = 8;

const keyOf = (row: TreeRow<ReviewFile>) => `${row.node.kind === "folder" ? "d" : "f"}:${row.node.path}`;

export function FileTree({
  files,
  flat,
  picked,
  isViewed,
  comments,
  onPick,
}: {
  /** null while loading. */
  files: ReviewFile[] | null;
  /** A flat list of paths (while searching) rather than folders. */
  flat: boolean;
  picked: string | null;
  isViewed: (f: ReviewFile) => boolean;
  /** Open conversations on a file. */
  comments: (path: string) => number;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(picked ? `f:${picked}` : null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  const box = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const rows = useMemo<Array<TreeRow<ReviewFile>>>(
    () => (flat ? (files ?? []).map((file) => ({ node: { kind: "file" as const, path: file.path, name: file.path, file }, depth: 0, parent: null })) : flatten(tree, collapsed)),
    [flat, files, tree, collapsed],
  );
  const at = cursor ? rows.findIndex((r) => keyOf(r) === cursor) : -1;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Brings a row into view, as a list scrolls to its selection. */
  const reveal = (index: number) => {
    const el = box.current;
    if (!el || index < 0) return;
    if (index * ROW < el.scrollTop) el.scrollTop = index * ROW;
    else if ((index + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (index + 1) * ROW - el.clientHeight;
  };

  // A file picked elsewhere (a comment jumped to, the next file to review): its folders open and
  // its row is selected and brought into view.
  useEffect(() => {
    if (!picked) return;
    setCursor(`f:${picked}`);
    setCollapsed((c) => {
      const closed = foldersOf(picked).filter((p) => c.has(p));
      return closed.length ? new Set([...c].filter((p) => !closed.includes(p))) : c;
    });
  }, [picked]);
  useEffect(() => reveal(at), [at]);

  const toggle = (path: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (open ?? next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const activate = (row: TreeRow<ReviewFile>) => {
    setCursor(keyOf(row));
    if (row.node.kind === "folder") toggle(row.node.path);
    else onPick(row.node.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      const row = rows[at];
      if (!row) return;
      e.preventDefault();
      activate(row);
      return;
    }
    const action = outlineKey(rows, at, e.key, flat ? new Set<string>() : collapsed);
    if (!action) return;
    e.preventDefault();
    if ("focus" in action) {
      const row = rows[action.focus]!;
      setCursor(keyOf(row));
      // Moving through files shows each, as Mail shows the message selected.
      if (row.node.kind === "file") onPick(row.node.path);
    } else if ("expand" in action) toggle(action.expand, true);
    else toggle(action.collapse, false);
  };

  if (!files)
    return (
      <ul className="flex flex-col px-2.5 py-1.5" aria-busy>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="flex h-(--row-h-sm) items-center gap-2 px-2">
            <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${70 - i * 6}%` }} />
            <Skeleton className="h-3 w-10" />
          </li>
        ))}
      </ul>
    );

  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + height) / ROW) + OVERSCAN);

  return (
    // A source list: no highlight under the pointer; the selected row in the accent while the list
    // has focus, gray otherwise (and in a window that isn't in front).
    <div
      ref={box}
      role="tree"
      tabIndex={0}
      aria-label={t("review.files")}
      aria-activedescendant={at >= 0 ? `tree-row-${at}` : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => at < 0 && rows[0] && setCursor(keyOf(rows[0]))}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      className="group/list min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-1.5 outline-none focus-ring-inset"
    >
      <div className="relative" style={{ height: rows.length * ROW }}>
        {rows.slice(first, last).map((row, i) => {
          const index = first + i;
          const node = row.node;
          const selected = index === at;
          const folder = node.kind === "folder" ? node : null;
          const file = node.kind === "file" ? node.file : null;
          const open = folder ? !collapsed.has(folder.path) : false;
          const viewedCount = folder ? folder.files.filter(isViewed).length : 0;
          const talk = folder ? folder.files.reduce((n, f) => n + comments(f.path), 0) : comments(node.path);
          const done = file ? isViewed(file) : viewedCount === folder!.files.length;
          const old = file ? renamed(file, !flat) : null;
          const slash = flat ? node.path.lastIndexOf("/") : -1;
          return (
            <div
              key={keyOf(row)}
              id={`tree-row-${index}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={folder ? open : undefined}
              aria-selected={selected}
              title={old && file ? `${file.previousPath} → ${file.path}` : node.path}
              onClick={() => {
                box.current?.focus({ preventScroll: true });
                activate(row);
              }}
              style={{ top: index * ROW, paddingLeft: 8 + row.depth * 14 }}
              data-selected={selected}
              className={cn(
                "absolute inset-x-0 flex h-(--row-h-sm) cursor-default items-center gap-1.5 rounded-(--radius-row) pr-2 text-callout select-none",
                "data-[selected=true]:bg-(--selection-bg-inactive) group-focus-within/list:data-[selected=true]:bg-(--selection-bg) group-focus-within/list:data-[selected=true]:text-(--selection-fg) group-focus-within/list:data-[selected=true]:**:text-(--selection-fg)",
                done && "text-muted-foreground",
              )}
            >
              {folder ? (
                <>
                  <ChevronRight aria-hidden className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none", open && "rotate-90")} />
                  <Folder aria-hidden className="mx-0.5 size-3.5 shrink-0 text-(--blue)" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {talk ? (
                    <span className="text-subheadline text-unread tabular-nums" aria-label={t("review.openConversations", { count: talk })}>
                      {talk}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-subheadline text-muted-foreground tabular-nums" aria-label={t("diff.folderViewed", { viewed: viewedCount, total: folder.files.length })}>
                    {viewedCount}/{folder.files.length}
                  </span>
                </>
              ) : (
                <>
                  {/* Lined up under the folders' names, past where their triangle is. */}
                  {flat ? null : <span aria-hidden className="w-3 shrink-0" />}
                  <FileIcon path={node.path} className={cn(done && "opacity-60")} />
                  {/* Renamed: "old → new", the old name giving way first so the new one stays readable. */}
                  <span className="flex min-w-0 flex-1 font-mono">
                    {old ? <span className="min-w-0 shrink truncate text-muted-foreground">{old}&nbsp;→&nbsp;</span> : null}
                    <span className={cn("truncate", old && "shrink-0 max-w-full")}>
                      {flat ? <span className="text-muted-foreground">{node.path.slice(0, slash + 1)}</span> : null}
                      {flat ? node.path.slice(slash + 1) : node.name}
                    </span>
                  </span>
                  {talk ? (
                    <span className="text-subheadline text-unread tabular-nums" aria-label={t("review.openConversations", { count: talk })}>
                      {talk}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-subheadline tabular-nums">
                    <span className="text-success">+{file!.additions}</span> <span className="text-destructive">−{file!.deletions}</span>
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
