// The pull request's files as one virtualized list (@pierre/diffs' CodeView): sticky file headers
// with the size and a Viewed box, conversations and pending comments between the lines, and the
// "+" beside a line to comment on it. Viewed files fold away, as on GitHub. The lines between
// hunks expand from both versions of the file (contents.ts), whitespace changes can be hidden,
// Markdown can be read rendered, and files GitHub sends no patch for show what can be shown of
// them after the rest (rich-diff.tsx).

import {
  getSingularPatch,
  parseDiffFromFile,
  type CodeViewItem,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { BookOpen, Code, MessageSquarePlus, MoreHorizontal, Plus } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";

import { Button } from "@/components/button/button";
import { Checkbox } from "@/components/checkbox/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/context-menu/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { isMarkdown, Rendered } from "@/components/rendered/rendered";
import { NoPatchFile } from "@/components/rich-diff/rich-diff";
import { DraftView, FindingView, NewComment, ThreadView } from "@/components/thread/thread";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import type { Exchange, Finding } from "@/utils/ai/ai";
import type { AiAnswer } from "@/utils/bridge/bridge";
import { bridge } from "@/utils/bridge/bridge";
import { BinaryFile, bothVersions, type Source } from "@/utils/contents/contents";
import type { OnScreen } from "@/utils/estimate/estimate";
import { i18n, useT, type T } from "@/utils/i18n/i18n";
import { diffLink, permalink } from "@/utils/permalink/permalink";
import { findingSide, placeThread, shows, type Placement } from "@/utils/placement/placement";
import { lineRange } from "@/utils/range/range";
import type { Draft, ReviewFile, Thread } from "@/utils/review/review";
import { ignoreWhitespace } from "@/utils/whitespace/whitespace";

type Annotation =
  | { kind: "thread"; thread: Thread; moved: boolean }
  | { kind: "draft"; draft: Draft }
  | { kind: "finding"; finding: Finding }
  | { kind: "new"; path: string; range: SelectedLineRange; file?: boolean }
  | { kind: "rendered"; file: ReviewFile };

type Side = Thread["side"];

export type DiffsHandle = {
  scrollToFile: (path: string) => void;
  /** At a line on a side (the new version's when not said); the file's top when it isn't shown. */
  scrollToLine: (path: string, line: number, side?: Side) => void;
  /** Where the conversation is shown: at its line, or the top of its file. */
  scrollToThread: (thread: Thread) => void;
  scrollToTop: () => void;
  /** The files in the list, in order: those with a diff (GitHub's, or loaded from both versions). */
  listed: () => string[];
  /** The files on screen and how much of it each takes, for the time spent on them. */
  onScreen: () => OnScreen;
  /** The file at the top of the screen, and whether it's been brought all the way up. */
  atTop: () => { path: string; reached: boolean } | null;
};

/** Where the pull request is on github.com, for links to its lines. */
export type LinkTarget = { owner: string; repo: string; number: number; head: string };

type Props = {
  files: ReviewFile[];
  threads: Map<string, Thread[]>;
  drafts: Draft[];
  /** The AI review's comments on the diff's lines, and who made them. */
  findings: Finding[];
  findingsBy: string;
  onAcceptFinding: (finding: Finding, side: Side) => void;
  /** Asks the AI about selected lines; null when there's no AI. */
  onAsk:
    | ((
        path: string,
        range: SelectedLineRange,
        question: string,
        earlier: Exchange[],
        run: string,
      ) => Promise<AiAnswer>)
    | null;
  onDismissFinding: (finding: Finding) => void;
  isViewed: (file: ReviewFile) => boolean;
  /** Viewed files opened anyway (to show a comment in one): they don't fold. */
  opened: Set<string>;
  diffStyle: "split" | "unified";
  wrap: boolean;
  /** Whitespace changes hidden (GitHub's "Hide whitespace"). */
  whitespace: boolean;
  dark: boolean;
  /** Both versions of the files, to expand context and load what GitHub sent no patch for; null
   *  until the pull request's head is known. */
  source: Source | null;
  /** False for an older range of commits: its lines aren't the head's, so no new comments on them. */
  commentable: boolean;
  link: LinkTarget | null;
  /** Says something for a moment (the toolbar's notice): "Link copied". */
  onSay: (message: string) => void;
  onViewed: (file: ReviewFile, viewed: boolean) => void;
  onAddDraft: (draft: Omit<Draft, "key">) => void;
  onEditDraft: (key: string, body: string) => void;
  onRemoveDraft: (key: string) => void;
  onCommentNow: (draft: Omit<Draft, "key">) => Promise<void>;
  onReply: (thread: Thread, body: string) => Promise<void>;
  onResolve: (thread: Thread, resolved: boolean) => Promise<void>;
};

/** A small, stable number for a string: an item's version must change whenever what it shows does. */
const version = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
};

const describe = (range: SelectedLineRange, t: T) => {
  const [a, b] = [Math.min(range.start, range.end), Math.max(range.start, range.end)];
  return a === b ? t("review.line", { line: String(b) }) : t("review.lines", { start: String(a), end: String(b) });
};

const toDraft = (path: string, range: SelectedLineRange, body: string): Omit<Draft, "key"> => ({
  path,
  ...lineRange(range),
  body,
});

/** Things kept by path, in their order: each file's own, looked up once rather than filtered for. */
function byPath<V extends { path: string }>(list: V[]) {
  const map = new Map<string, V[]>();
  for (const v of list) {
    const all = map.get(v.path);
    if (all) all.push(v);
    else map.set(v.path, [v]);
  }
  return map;
}

/** A rendered Markdown file is a file item (one column, the width of the list) of one blank line,
 *  hidden (RENDERED_CSS), with the rendered page above it as a file-wide annotation. */
const renderedItem = (file: ReviewFile, version: number, collapsed: boolean): CodeViewItem<Annotation> => ({
  id: file.path,
  type: "file",
  file: { name: file.path, contents: "\n", cacheKey: `rendered:${file.path}` },
  annotations: [{ lineNumber: 0, metadata: { kind: "rendered", file } }],
  collapsed,
  version,
});
/** Only rendered pages are file items: their blank line goes. */
const RENDERED_CSS = "pre[data-file] [data-line], pre[data-file] [data-column-number] { display: none; }";

/** The text fields where right-click is the system's (cut, copy, paste), not the code's menu. */
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "done"; diff: FileDiffMetadata };

export const Diffs = forwardRef<DiffsHandle, Props>(function Diffs(props, ref) {
  const t = useT();
  const {
    files,
    threads,
    drafts,
    findings,
    isViewed,
    opened,
    diffStyle,
    wrap,
    whitespace,
    dark,
    source,
    link,
    commentable,
  } = props;
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  // `file`: a comment on the file as a whole, written at its top.
  const [composing, setComposing] = useState<{ path: string; range: SelectedLineRange; file?: boolean } | null>(null);
  // Markdown files shown rendered rather than as source, by path.
  const [rendered, setRendered] = useState<Set<string>>(() => new Set());
  // Files GitHub sent no patch for, loaded from both versions on request.
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(() => new Map());
  // Parsing a patch is the costly part: once per file, patch and whitespace setting.
  const parsed = useRef(new Map<string, { patch: string; whitespace: boolean; diff: FileDiffMetadata }>());
  // Each item as last built, reused while its version holds, so the list sees nothing new.
  const built = useRef(new Map<string, CodeViewItem<Annotation>>());
  // Where each conversation was put, for stepping to it.
  const placed = useRef(new Map<string, Placement>());
  // The line under the pointer, for the contextual menu.
  const hovered = useRef<{ path: string; side: Side; line: number } | null>(null);
  const [menuAt, setMenuAt] = useState<{
    path: string;
    side: Side;
    start: number;
    end: number;
    startSide: Side;
  } | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const diffOf = (path: string) => {
    const item = built.current.get(path);
    return item?.type === "diff" ? item.fileDiff : null;
  };
  const scrollToFile = (path: string) => {
    if (built.current.has(path)) viewer.current?.scrollTo({ type: "item", id: path, align: "start" } as never);
    // One of the files after the list (no patch): its card, in the footer.
    else
      container.current
        ?.querySelector(`[id="file-${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const scrollToLine = (path: string, line: number, side: Side = "additions") => {
    const diff = diffOf(path);
    if (!diff || line <= 0 || !shows(diff, side, line)) return scrollToFile(path);
    viewer.current?.scrollTo({
      type: "line",
      id: path,
      lineNumber: line,
      side,
      align: "center",
      behavior: "smooth",
    } as never);
  };

  useImperativeHandle(ref, () => ({
    scrollToFile,
    scrollToLine,
    scrollToThread: (thread) => {
      const at = placed.current.get(thread.id);
      if (at && at.lineNumber > 0) scrollToLine(thread.path, at.lineNumber, at.side);
      else scrollToFile(thread.path);
    },
    scrollToTop: () => viewer.current?.scrollTo({ type: "position", position: 0 }),
    listed: () => [...built.current.keys()],
    onScreen: () => {
      const view = viewer.current?.getInstance();
      const box = view?.getContainerElement()?.getBoundingClientRect();
      if (!view || !box) return [];
      return view.getRenderedItems().flatMap(({ id, element }): OnScreen => {
        const r = element.getBoundingClientRect();
        const height = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
        return height > 0 ? [[id, height]] : [];
      });
    },
    atTop: () => {
      const view = viewer.current?.getInstance();
      const box = view?.getContainerElement()?.getBoundingClientRect();
      if (!view || !box) return null;
      const top = view.getRenderedItems().find(({ element }) => element.getBoundingClientRect().bottom > box.top + 1);
      // Brought up: its start is at the top (past the list's own padding), not still below it.
      return top ? { path: top.id, reached: top.element.getBoundingClientRect().top <= box.top + 24 } : null;
    },
  }));

  const filesByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const draftsByPath = useMemo(() => byPath(drafts), [drafts]);
  const findingsByPath = useMemo(() => byPath(findings.filter((x) => x.inDiff)), [findings]);

  const items = useMemo<Array<CodeViewItem<Annotation>>>(() => {
    const next = new Map<string, CodeViewItem<Annotation>>();
    const list = files.flatMap((f) => {
      const load = loaded.get(f.path);
      const fromBoth = load?.state === "done" ? load.diff : null;
      if (!f.patch && !fromBoth) return [];
      let diff = fromBoth;
      if (!diff) {
        let entry = parsed.current.get(f.path);
        if (!entry || entry.patch !== f.patch || entry.whitespace !== whitespace) {
          entry = {
            patch: f.patch,
            whitespace,
            diff: getSingularPatch(whitespace ? ignoreWhitespace(f.patch) : f.patch),
          };
          parsed.current.set(f.path, entry);
        }
        diff = entry.diff;
      }
      const asRendered = rendered.has(f.path);
      const fileThreads = threads.get(f.path) ?? [];
      const fileDrafts = draftsByPath.get(f.path) ?? [];
      const fileFindings = findingsByPath.get(f.path) ?? [];
      const viewed = isViewed(f) && !opened.has(f.path);
      const key = version(
        JSON.stringify([
          // The header and comments say things in words: drawn again in another language.
          t.locale,
          viewed,
          asRendered,
          whitespace,
          Boolean(fromBoth),
          fileThreads.map((t) => [t.id, t.resolved, t.comments.length]),
          fileDrafts.map((d) => [d.key, d.body]),
          fileFindings.map((x) => [x.line, x.body]),
          composing?.path === f.path ? [composing.range, composing.file] : null,
        ]),
      );
      const before = built.current.get(f.path);
      if (before && before.version === key && (before.type === "file" || before.fileDiff === diff)) {
        next.set(f.path, before);
        return [before];
      }
      if (asRendered) {
        const item = renderedItem(f, key, viewed);
        next.set(f.path, item);
        return [item];
      }
      const annotations: Array<DiffLineAnnotation<Annotation>> = [
        ...fileThreads.map((thread) => {
          // On the file, outdated, or on a line this diff no longer shows: at the top of the
          // file, saying where it was, rather than on whatever line now has that number.
          const at = placeThread(diff, thread);
          placed.current.set(thread.id, at);
          return {
            side: at.side,
            lineNumber: at.lineNumber,
            metadata: { kind: "thread" as const, thread, moved: at.moved },
          };
        }),
        // One on the file goes at its top, as its conversations do.
        ...fileDrafts.map((draft) => ({
          side: draft.side,
          lineNumber: draft.file ? 0 : draft.line,
          metadata: { kind: "draft" as const, draft },
        })),
        ...fileFindings.map((finding) => ({
          side: findingSide(diff, finding.line),
          lineNumber: finding.line,
          metadata: { kind: "finding" as const, finding },
        })),
        ...(composing?.path === f.path
          ? [
              composing.file
                ? {
                    side: "additions" as const,
                    lineNumber: 0,
                    metadata: { kind: "new" as const, path: f.path, range: composing.range, file: true },
                  }
                : {
                    side: lineRange(composing.range).side,
                    lineNumber: lineRange(composing.range).line,
                    metadata: { kind: "new" as const, path: f.path, range: composing.range },
                  },
            ]
          : []),
      ];
      const item: CodeViewItem<Annotation> = {
        id: f.path,
        type: "diff",
        fileDiff: diff,
        annotations,
        collapsed: viewed,
        version: key,
      };
      next.set(f.path, item);
      return [item];
    });
    built.current = next;
    return list;
  }, [files, threads, draftsByPath, findingsByPath, composing, isViewed, opened, t, whitespace, rendered, loaded]);

  const options = useMemo(
    () => ({
      diffStyle,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      // GitHub's own themes: every token readable (WCAG AA) on its background; Pierre's light one
      // has some below 3:1.
      theme: { dark: "github-dark-default", light: "github-light-default" },
      themeType: dark ? ("dark" as const) : ("light" as const),
      lineDiffType: "word" as const,
      stickyHeaders: true,
      enableGutterUtility: commentable,
      layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
      unsafeCSS: RENDERED_CSS,
      // Selecting lines (dragging over their numbers) opens the same box: comment or ask.
      enableLineSelection: commentable,
      onLineSelectionEnd: (range: SelectedLineRange | null, latest?: { item?: { id: string } }) => {
        if (range && latest?.item) setComposing({ path: latest.item.id, range });
      },
      onLineEnter: (line: { annotationSide: Side; lineNumber: number }, context?: { item?: { id: string } }) => {
        if (context?.item)
          hovered.current = { path: context.item.id, side: line.annotationSide, line: line.lineNumber };
      },
      onLineLeave: () => {
        hovered.current = null;
      },
      // The lines between hunks, from both versions of the file, fetched the first time any are
      // expanded (and kept for good: a commit never changes).
      ...(source
        ? {
            loadDiffFiles: async (fileDiff: FileDiffMetadata) => {
              const file = filesByPath.get(fileDiff.name);
              if (!file) throw new Error(fileDiff.name);
              const { oldText, newText } = await bothVersions(source, file);
              const newFile = { name: file.path, contents: newText ?? "", cacheKey: `${source.head}:${file.path}` };
              return fileDiff.type === "rename-pure"
                ? { oldFile: null, newFile }
                : { oldFile: { name: file.previousPath ?? file.path, contents: oldText ?? "" }, newFile };
            },
          }
        : {}),
    }),
    [diffStyle, wrap, dark, source, filesByPath, commentable],
  );

  /** Loads a file GitHub sent no patch for, from both its versions. */
  const loadFile = async (file: ReviewFile) => {
    if (!source) return;
    setLoaded((m) => new Map(m).set(file.path, { state: "loading" }));
    try {
      const { oldText, newText } = await bothVersions(source, file);
      const diff = parseDiffFromFile(
        oldText === null ? null : { name: file.previousPath ?? file.path, contents: oldText },
        newText === null ? null : { name: file.path, contents: newText },
      ) as FileDiffMetadata;
      setLoaded((m) => new Map(m).set(file.path, { state: "done", diff }));
    } catch (e) {
      const message =
        e instanceof BinaryFile
          ? t("diff.binary")
          : t("diff.loadFailed", { error: e instanceof Error ? e.message : String(e) });
      setLoaded((m) => new Map(m).set(file.path, { state: "error", message }));
    }
  };

  const copy = (text: string, done: string) =>
    navigator.clipboard.writeText(text).then(
      () => props.onSay(done),
      () => props.onSay(t("diff.noClipboard")),
    );
  /** A permalink: the new version's lines at the head commit, the old's at the merge base. */
  const copyPermalink = async (path: string, lines?: { side: Side; start: number; end: number }) => {
    if (!link || !source) return;
    const file = filesByPath.get(path);
    try {
      const old = lines?.side === "deletions" || file?.status === "removed";
      const sha = old ? await source.base() : link.head;
      await copy(permalink(link, sha, old ? (file?.previousPath ?? path) : path, lines), t("diff.linkCopied"));
    } catch (e) {
      props.onSay(e instanceof Error ? e.message : String(e));
    }
  };
  const copyDiffLink = async (path: string, lines?: { side: Side; start: number; end: number; startSide: Side }) => {
    if (link) await copy(await diffLink(link, path, lines), t("diff.linkCopied"));
  };

  const noPatch = files.filter((f) => !f.patch && loaded.get(f.path)?.state !== "done");

  return (
    <div
      ref={container}
      className="flex h-full flex-col"
      // The line counts in file headers in the app's own green and red, which pass contrast,
      // and a lighter highlight on changed words, so code colored on it stays readable (4.5:1).
      style={
        {
          "--diffs-addition-color-override": "var(--success)",
          "--diffs-deletion-color-override": "var(--destructive)",
          "--diffs-bg-addition-emphasis-override": dark ? "#183323" : "#e0f8e6",
          "--diffs-bg-deletion-emphasis-override": dark ? "#4a2326" : "#fff0ee",
          ...(dark ? {} : { "--diffs-bg-addition-override": "#f3fcf5", "--diffs-bg-deletion-override": "#fff6f5" }),
          // Selected lines in a pale blue (dark: deep blue) every syntax color stays readable on;
          // the default amber took some below 4.5:1.
          "--diffs-bg-selection-override": dark ? "#1b2c47" : "#dcebff",
        } as React.CSSProperties
      }
    >
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) return;
          const line = hovered.current;
          if (!line) return setMenuAt(null);
          // Lines picked in that file: the menu is about them; otherwise the line under the pointer.
          const range = composing?.path === line.path ? lineRange(composing.range) : null;
          setMenuAt(
            range
              ? {
                  path: line.path,
                  side: range.side,
                  end: range.line,
                  start: range.startLine ?? range.line,
                  startSide: range.startSide ?? range.side,
                }
              : { path: line.path, side: line.side, start: line.line, end: line.line, startSide: line.side },
          );
        }}
      >
        <ContextMenuTrigger
          className="flex min-h-0 flex-1 flex-col"
          // The code's own menu only over a line; the system's in text fields, over selected
          // text and elsewhere (a link in a comment, say).
          onContextMenuCapture={(e) => {
            const selected = window.getSelection();
            if (!hovered.current || typing(e.target) || (selected && !selected.isCollapsed)) e.stopPropagation();
          }}
        >
          <CodeView<Annotation, undefined>
            ref={viewer}
            items={items}
            // The code can be selected and copied (it inherits into the library's shadow root).
            className="selectable min-h-0 flex-1"
            // Room at the end for the filter bar that floats over it.
            style={{ height: "100%", overflow: "auto", paddingBottom: 72 }}
            options={options as never}
            // The "+" beside a line: the library's own has no name for a screen reader; this one says
            // what it does. (Several lines: drag over their numbers.)
            renderGutterUtility={(getHovered, item) => (
              <button
                type="button"
                aria-label={t("review.commentOnLine")}
                onClick={() => {
                  const line = getHovered();
                  if (!line) return;
                  const side = ("side" in line ? line.side : "additions") as SelectedLineRange["side"];
                  setComposing({
                    path: item.id,
                    range: { start: line.lineNumber, end: line.lineNumber, side, endSide: side },
                  });
                }}
                className="flex size-5 cursor-default items-center justify-center rounded-[5px] bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.3)] active:brightness-90"
              >
                <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
              </button>
            )}
            renderHeaderMetadata={(item) => {
              const file = filesByPath.get(item.id);
              if (!file) return null;
              const asRendered = rendered.has(file.path);
              return (
                <span
                  className="flex items-center gap-0.5 font-sans text-foreground select-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isMarkdown(file.path) && source && file.patch ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={asRendered}
                            aria-label={asRendered ? t("diff.showSource") : t("diff.showRendered")}
                            className="text-muted-foreground aria-pressed:text-primary"
                            onClick={() =>
                              setRendered((s) =>
                                s.has(file.path)
                                  ? new Set([...s].filter((p) => p !== file.path))
                                  : new Set([...s, file.path]),
                              )
                            }
                          />
                        }
                      >
                        {asRendered ? <Code /> : <BookOpen />}
                      </TooltipTrigger>
                      <TooltipContent>{asRendered ? t("diff.showSource") : t("diff.showRendered")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground"
                          aria-label={t("review.commentOnFile", { path: file.path })}
                          onClick={() =>
                            setComposing({
                              path: file.path,
                              range: { start: 0, end: 0, side: "additions", endSide: "additions" },
                              file: true,
                            })
                          }
                        />
                      }
                    >
                      <MessageSquarePlus />
                    </TooltipTrigger>
                    <TooltipContent>{t("review.commentOnFileTip")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground"
                          aria-label={t("diff.fileActions", { path: file.path })}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void copy(file.path, t("diff.pathCopied"))}>
                        {t("diff.copyPath")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!link || !source} onClick={() => void copyPermalink(file.path)}>
                        {t("diff.copyPermalink")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!link} onClick={() => void copyDiffLink(file.path)}>
                        {t("diff.copyDiffLink")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!link || file.status === "removed"}
                        onClick={() => link && void bridge.openUrl(permalink(link, link.head, file.path))}
                      >
                        {t("diff.openFile")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <label className="flex items-center gap-1.5 px-1.5 py-1 text-body">
                    <Checkbox
                      checked={isViewed(file)}
                      onCheckedChange={(v) => props.onViewed(file, v)}
                      aria-label={t("review.viewedFile", { path: file.path })}
                      className="size-3.5"
                    />
                    {t("review.viewed")}
                  </label>
                </span>
              );
            }}
            renderAnnotation={(...[annotation]) => {
              const a = annotation.metadata as Annotation;
              if (a.kind === "rendered") return source ? <Rendered file={a.file} source={source} /> : null;
              if (a.kind === "thread")
                return (
                  <ThreadView
                    thread={a.thread}
                    moved={a.moved}
                    onReply={(body) => props.onReply(a.thread, body)}
                    onResolve={(resolved) => props.onResolve(a.thread, resolved)}
                  />
                );
              if (a.kind === "draft")
                return (
                  <DraftView
                    draft={a.draft}
                    onEdit={(body) => props.onEditDraft(a.draft.key, body)}
                    onRemove={async () => {
                      const t = i18n();
                      if (
                        await bridge.confirm(
                          t("review.removeDraftConfirm"),
                          t("review.removeDraftConfirmMessage"),
                          t("review.removeDraftConfirmButton"),
                        )
                      )
                        props.onRemoveDraft(a.draft.key);
                    }}
                  />
                );
              if (a.kind === "finding") {
                const diff = diffOf(a.finding.path);
                return (
                  <FindingView
                    finding={a.finding}
                    by={props.findingsBy}
                    onAdd={() =>
                      props.onAcceptFinding(a.finding, diff ? findingSide(diff, a.finding.line) : "additions")
                    }
                    onDismiss={() => props.onDismissFinding(a.finding)}
                  />
                );
              }
              return (
                <NewComment
                  lines={a.file ? t("review.theFile") : describe(a.range, t)}
                  path={a.path}
                  range={a.range}
                  file={a.file}
                  onAdd={(body) => {
                    props.onAddDraft(
                      a.file
                        ? { path: a.path, side: "additions", line: 0, body, file: true }
                        : toDraft(a.path, a.range, body),
                    );
                    setComposing(null);
                  }}
                  onSendNow={async (body) => {
                    await props.onCommentNow(
                      a.file
                        ? { path: a.path, side: "additions", line: 0, body, file: true }
                        : toDraft(a.path, a.range, body),
                    );
                    setComposing(null);
                  }}
                  onCancel={() => setComposing(null)}
                  ask={
                    props.onAsk
                      ? (question, earlier, run) => props.onAsk!(a.path, a.range, question, earlier, run)
                      : null
                  }
                  askName={props.findingsBy}
                />
              );
            }}
            renderCodeViewFooter={() =>
              noPatch.length ? (
                <div className="flex flex-col gap-3 px-3 pb-6">
                  {noPatch.map((f) => {
                    const load = loaded.get(f.path);
                    return (
                      <NoPatchFile
                        key={f.path}
                        file={f}
                        source={source}
                        // Still one to tick off, or the review never adds up.
                        viewed={isViewed(f)}
                        loading={load?.state === "loading"}
                        error={load?.state === "error" ? load.message : null}
                        onViewed={(v) => props.onViewed(f, v)}
                        onLoad={() => void loadFile(f)}
                      />
                    );
                  })}
                </div>
              ) : null
            }
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuAt ? (
            <>
              <DropdownMenuItem
                onClick={() =>
                  setComposing({
                    path: menuAt.path,
                    range: { start: menuAt.start, side: menuAt.startSide, end: menuAt.end, endSide: menuAt.side },
                  })
                }
              >
                {t("diff.commentHere")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!link || !source || menuAt.startSide !== menuAt.side}
                onClick={() =>
                  void copyPermalink(menuAt.path, { side: menuAt.side, start: menuAt.start, end: menuAt.end })
                }
              >
                {t("diff.copyPermalink")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!link} onClick={() => void copyDiffLink(menuAt.path, menuAt)}>
                {t("diff.copyDiffLink")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void copy(menuAt.path, t("diff.pathCopied"))}>
                {t("diff.copyPath")}
              </DropdownMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
});
