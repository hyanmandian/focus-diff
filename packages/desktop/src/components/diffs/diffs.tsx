import type { OnScreen } from "@focus-diff/core/active-time";
import {
  getSingularPatch,
  parseDiffFromFile,
  type CodeViewItem,
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type OnDiffLineEnterLeaveProps,
  type OnLineEnterLeaveProps,
  type SelectedLineRange,
} from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { BookOpen, Code, MessageSquarePlus, MoreHorizontal, Plus } from "lucide-react";
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

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
import { chatKey, forget, setOpen, usePullAsking, type Open } from "@/utils/asking/asking";
import type { AiAnswer } from "@/utils/bridge/bridge";
import { bridge } from "@/utils/bridge/bridge";
import { BinaryFile, bothVersions, type Source } from "@/utils/contents/contents";
import { errorText } from "@/utils/error/error";
import { labelExpandButtons } from "@/utils/expand-buttons/expand-buttons";
import { rangesIn, type FindMatch } from "@/utils/find/find";
import { i18n, useT, type T } from "@/utils/i18n/i18n";
import { typing } from "@/utils/keys/keys";
import { diffLink, permalink } from "@/utils/permalink/permalink";
import { findingSide, placeThread, shows, type Placement } from "@/utils/placement/placement";
import { lineRange } from "@/utils/range/range";
import type { Draft, ReviewFile, Thread } from "@/utils/review/review";
import { ignoreWhitespace } from "@/utils/whitespace/whitespace";

type Annotation =
  | { kind: "thread"; thread: Thread; moved: boolean }
  | { kind: "draft"; draft: Draft }
  | { kind: "finding"; finding: Finding; side: Side }
  | { kind: "new"; path: string; range: SelectedLineRange; file?: boolean | undefined }
  | { kind: "rendered"; file: ReviewFile };

type Side = Thread["side"];

export type DiffsHandle = {
  scrollToFile: (path: string) => void;
  scrollToLine: (path: string, line: number, side?: Side) => void;
  scrollToThread: (thread: Thread) => void;
  scrollToTop: () => void;
  listed: () => string[];
  find: (query: string, current: FindMatch | null) => void;
  onScreen: () => OnScreen;
  atTop: () => { path: string; reached: boolean } | null;
};

export type LinkTarget = { owner: string; repo: string; number: number; head: string };

type Props = {
  pull: string;
  files: ReviewFile[];
  threads: Map<string, Thread[]>;
  drafts: Draft[];
  findings: Finding[];
  findingsBy: string;
  onAcceptFinding: (finding: Finding, side: Side) => void;
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
  opened: Set<string>;
  diffStyle: "split" | "unified";
  wrap: boolean;
  whitespace: boolean;
  dark: boolean;
  source: Source | null;
  commentable: boolean;
  link: LinkTarget | null;
  onSay: (message: string) => void;
  onViewed: (file: ReviewFile, viewed: boolean) => void;
  onAddDraft: (draft: Omit<Draft, "key">) => void;
  onEditDraft: (key: string, body: string) => void;
  onRemoveDraft: (key: string) => void;
  onCommentNow: (draft: Omit<Draft, "key">) => Promise<void>;
  onReply: (thread: Thread, body: string) => Promise<void>;
  onResolve: (thread: Thread, resolved: boolean) => Promise<void>;
};

const version = (s: string) => {
  let h = 0;
  // oxlint-disable-next-line unicorn/prefer-math-trunc, unicorn/prefer-code-point -- see above
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

const draftOf = (
  a: { path: string; range: SelectedLineRange; file?: boolean | undefined },
  body: string,
): Omit<Draft, "key"> =>
  a.file ? { path: a.path, side: "additions", line: 0, body, file: true } : toDraft(a.path, a.range, body);

function byPath<V extends { path: string }>(list: V[]) {
  const map = new Map<string, V[]>();
  for (const v of list) {
    const all = map.get(v.path);
    if (all) all.push(v);
    else map.set(v.path, [v]);
  }
  return map;
}

const renderedItem = (file: ReviewFile, key: number, collapsed: boolean): CodeViewItem<Annotation> => ({
  id: file.path,
  type: "file",
  file: { name: file.path, contents: "\n", cacheKey: `rendered:${file.path}` },
  annotations: [{ lineNumber: 0, metadata: { kind: "rendered", file } }],
  collapsed,
  version: key,
});
const RENDERED_CSS = "pre[data-file] [data-line], pre[data-file] [data-column-number] { display: none; }";
const GUTTER_CSS = `[data-gutter-utility-slot] { right: auto; left: calc(100% - 4px); justify-content: flex-start; align-items: center; z-index: 2; }
[data-selected-line] [data-gutter-utility-slot] { display: none; }
[data-column-number][data-selected-line], [data-gutter-buffer][data-selected-line] { color: var(--diffs-selection-number-fg-override); }`;
const FIND_CSS = `::highlight(find) { background-color: rgb(255 204 0 / 0.4); }
::highlight(find-current) { background-color: rgb(255 149 0 / 0.9); color: black; }`;

class Cache {
  private parsed = new Map<string, { patch: string; whitespace: boolean; diff: FileDiffMetadata }>();
  private items = new Map<string, CodeViewItem<Annotation>>();
  readonly placed = new Map<string, Placement>();

  parse(file: ReviewFile, whitespace: boolean): FileDiffMetadata {
    let entry = this.parsed.get(file.path);
    if (!entry || entry.patch !== file.patch || entry.whitespace !== whitespace) {
      entry = {
        patch: file.patch,
        whitespace,
        diff: getSingularPatch(whitespace ? ignoreWhitespace(file.patch) : file.patch),
      };
      this.parsed.set(file.path, entry);
    }
    return entry.diff;
  }
  built(path: string) {
    return this.items.get(path);
  }
  keep(items: Map<string, CodeViewItem<Annotation>>) {
    this.items = items;
  }
  listed() {
    return [...this.items.keys()];
  }
}

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string; binary: boolean }
  | { state: "done"; diff: FileDiffMetadata };

function paintFound(
  view: { getRenderedItems: () => Array<{ id: string; element: HTMLElement }> } | undefined,
  { query, current }: { query: string; current: FindMatch | null },
) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const all: Range[] = [];
  const here: Range[] = [];
  for (const { id, element } of view?.getRenderedItems() ?? []) {
    const roots = [element, ...element.querySelectorAll("diffs-container")].flatMap((e) =>
      e.shadowRoot ? [e.shadowRoot] : [],
    );
    for (const line of roots.flatMap((root) => [...root.querySelectorAll("[data-line]")])) {
      const ranges = rangesIn(line, query);
      all.push(...ranges);
      const deletion = line.closest("code[data-deletions]")
        ? true
        : line.closest("code[data-additions]")
          ? false
          : line.getAttribute("data-line-type") === "change-deletion";
      const range = ranges[current?.nth ?? 0];
      if (
        range &&
        current?.path === id &&
        Number(line.getAttribute("data-line")) === current.line &&
        deletion === (current.side === "deletions")
      )
        here.push(range);
    }
  }
  CSS.highlights.set("find", new Highlight(...all));
  CSS.highlights.set("find-current", new Highlight(...here));
}

export function Diffs({ ref, ...props }: Props & { ref?: Ref<DiffsHandle> }) {
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
  const { pull } = props;
  const composing = usePullAsking(pull).open;
  const setComposing = (open: Open | null) => {
    setOpen(pull, open);
  };
  const [rendered, setRendered] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(() => new Map());
  const [cache] = useState(() => new Cache());
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
    const item = cache.built(path);
    return item?.type === "diff" ? item.fileDiff : null;
  };
  const scrollToFile = (path: string) => {
    if (cache.built(path)) {
      viewer.current?.scrollTo({ type: "item", id: path, align: "start" });
      return;
    }
    const below = () => container.current?.querySelector(`[id="file-${CSS.escape(path)}"]`);
    const at = below();
    if (at) {
      at.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    viewer.current?.scrollTo({ type: "position", position: Number.MAX_SAFE_INTEGER });
    requestAnimationFrame(() => below()?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const scrollToLine = (path: string, line: number, side: Side = "additions") => {
    const diff = diffOf(path);
    if (!diff || line <= 0 || !shows(diff, side, line)) {
      scrollToFile(path);
      return;
    }
    viewer.current?.scrollTo({
      type: "line",
      id: path,
      lineNumber: line,
      side,
      align: "center",
      behavior: "smooth",
    });
  };

  const found = useRef<{ query: string; current: FindMatch | null }>({ query: "", current: null });
  useImperativeHandle(ref, () => ({
    scrollToFile,
    scrollToLine,
    scrollToThread: (thread) => {
      const at = cache.placed.get(thread.id);
      if (at && at.lineNumber > 0) scrollToLine(thread.path, at.lineNumber, at.side);
      else scrollToFile(thread.path);
    },
    scrollToTop: () => viewer.current?.scrollTo({ type: "position", position: 0 }),
    listed: () => cache.listed(),
    find: (query, current) => {
      found.current = { query, current };
      paintFound(viewer.current?.getInstance(), found.current);
    },
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
      const diff = fromBoth ?? cache.parse(f, whitespace);
      const asRendered = rendered.has(f.path);
      const fileThreads = threads.get(f.path) ?? [];
      const fileDrafts = draftsByPath.get(f.path) ?? [];
      const fileFindings = findingsByPath.get(f.path) ?? [];
      const viewed = isViewed(f) && !opened.has(f.path);
      const key = version(
        JSON.stringify([
          t.locale,
          viewed,
          asRendered,
          whitespace,
          Boolean(fromBoth),
          fileThreads.map((thread) => [thread.id, thread.resolved, thread.comments.length]),
          fileDrafts.map((d) => [d.key, d.body]),
          fileFindings.map((x) => [x.line, x.body]),
          composing?.path === f.path ? [composing.range, composing.file] : null,
        ]),
      );
      const before = cache.built(f.path);
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
          const at = placeThread(diff, thread);
          cache.placed.set(thread.id, at);
          return {
            side: at.side,
            lineNumber: at.lineNumber,
            metadata: { kind: "thread" as const, thread, moved: at.moved },
          };
        }),
        ...fileDrafts.map((draft) => ({
          side: draft.side,
          lineNumber: draft.file ? 0 : draft.line,
          metadata: { kind: "draft" as const, draft },
        })),
        ...fileFindings.map((finding) => ({
          side: findingSide(diff, finding.line),
          lineNumber: finding.line,
          metadata: { kind: "finding" as const, finding, side: findingSide(diff, finding.line) },
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
    cache.keep(next);
    return list;
  }, [
    files,
    threads,
    draftsByPath,
    findingsByPath,
    composing,
    isViewed,
    opened,
    t,
    whitespace,
    rendered,
    loaded,
    cache,
  ]);

  const options = useMemo(
    () => ({
      diffStyle,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      theme: { dark: "github-dark-default", light: "github-light-default" },
      themeType: dark ? ("dark" as const) : ("light" as const),
      lineDiffType: "word" as const,
      stickyHeaders: true,
      enableGutterUtility: commentable,
      layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
      unsafeCSS: `${RENDERED_CSS}\n${GUTTER_CSS}\n${FIND_CSS}`,
      onPostRender: (node: HTMLElement) => {
        labelExpandButtons(node, t);
        if (found.current.query) paintFound(viewer.current?.getInstance(), found.current);
      },
      enableLineSelection: commentable,
      onLineSelectionEnd: (range: SelectedLineRange | null, latest?: { item?: { id: string } }) => {
        if (range && latest?.item) setOpen(pull, { path: latest.item.id, range });
      },
      onLineEnter: (line: OnLineEnterLeaveProps | OnDiffLineEnterLeaveProps, context?: { item?: { id: string } }) => {
        if (context?.item && "annotationSide" in line)
          hovered.current = { path: context.item.id, side: line.annotationSide, line: line.lineNumber };
      },
      onLineLeave: () => {
        hovered.current = null;
      },
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
    [diffStyle, wrap, dark, source, filesByPath, commentable, t, pull],
  );

  const loadFile = async (file: ReviewFile) => {
    if (!source) return;
    setLoaded((m) => new Map(m).set(file.path, { state: "loading" }));
    try {
      const { oldText, newText } = await bothVersions(source, file);
      const diff = parseDiffFromFile(
        oldText === null ? null : { name: file.previousPath ?? file.path, contents: oldText },
        newText === null ? null : { name: file.path, contents: newText },
      );
      setLoaded((m) => new Map(m).set(file.path, { state: "done", diff }));
    } catch (e) {
      const message = e instanceof BinaryFile ? t("diff.binary") : t("diff.loadFailed", { error: errorText(e) });
      setLoaded((m) => new Map(m).set(file.path, { state: "error", message, binary: e instanceof BinaryFile }));
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      props.onSay(t("diff.noClipboard"));
      return;
    }
    props.onSay(done);
  };
  const copyPermalink = async (
    to: LinkTarget,
    from: Source,
    path: string,
    lines?: { side: Side; start: number; end: number },
  ) => {
    const file = filesByPath.get(path);
    try {
      const old = lines?.side === "deletions" || file?.status === "removed";
      const sha = old ? await from.base() : from.head;
      await copy(permalink(to, sha, old ? (file?.previousPath ?? path) : path, lines), t("diff.linkCopied"));
    } catch (e) {
      props.onSay(errorText(e));
    }
  };
  const copyDiffLink = async (
    to: LinkTarget,
    path: string,
    lines?: { side: Side; start: number; end: number; startSide: Side },
  ) => {
    await copy(await diffLink(to, path, lines), t("diff.linkCopied"));
  };

  const removeDraft = async (key: string) => {
    const say = i18n();
    if (
      await bridge.confirm(
        say("review.removeDraftConfirm"),
        say("review.removeDraftConfirmMessage"),
        say("review.removeDraftConfirmButton"),
      )
    )
      props.onRemoveDraft(key);
  };

  const noPatch = files.filter((f) => !f.patch && loaded.get(f.path)?.state !== "done");

  const colors: Record<`--${string}`, string> = {
    "--diffs-addition-color-override": "var(--success)",
    "--diffs-deletion-color-override": "var(--destructive)",
    "--diffs-bg-addition-emphasis-override": dark ? "#183323" : "#e0f8e6",
    "--diffs-bg-deletion-emphasis-override": dark ? "#4a2326" : "#fff0ee",
    ...(dark ? {} : { "--diffs-bg-addition-override": "#f3fcf5", "--diffs-bg-deletion-override": "#fff6f5" }),
    "--diffs-bg-selection-override": dark ? "#1b2c47" : "#dcebff",
    "--diffs-bg-selection-number-override": dark ? "#1f6feb" : "#9ec5fe",
    "--diffs-selection-number-fg-override": dark ? "#cae0ff" : "#0a3069",
  };

  return (
    <div ref={container} className="flex h-full flex-col" style={colors}>
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) return;
          const line = hovered.current;
          const range = line && composing?.path === line.path ? lineRange(composing.range) : null;
          setMenuAt(
            range && line
              ? {
                  path: line.path,
                  side: range.side,
                  end: range.line,
                  start: range.startLine ?? range.line,
                  startSide: range.startSide ?? range.side,
                }
              : line && { path: line.path, side: line.side, start: line.line, end: line.line, startSide: line.side },
          );
        }}
      >
        <ContextMenuTrigger
          className="flex min-h-0 flex-1 flex-col"
          onContextMenuCapture={(e) => {
            const selected = window.getSelection();
            if (!hovered.current || typing(e.target) || (selected && !selected.isCollapsed)) e.stopPropagation();
          }}
        >
          <CodeView<Annotation>
            ref={viewer}
            items={items}
            className="selectable min-h-0 flex-1"
            style={{ height: "100%", overflow: "auto", paddingBottom: 72 }}
            options={options}
            renderGutterUtility={(getHovered, item) => (
              <button
                type="button"
                aria-label={t("review.commentOnLine")}
                onClick={() => {
                  const line = getHovered();
                  if (!line) return;
                  const side: Side = "side" in line && line.side === "deletions" ? "deletions" : "additions";
                  setComposing({
                    path: item.id,
                    range: { start: line.lineNumber, end: line.lineNumber, side, endSide: side },
                  });
                }}
                className="flex size-5 cursor-default items-center justify-center rounded-[5px] bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.3)] hover:brightness-110 active:brightness-90"
              >
                <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
              </button>
            )}
            renderHeaderMetadata={(item) => {
              const file = filesByPath.get(item.id);
              if (!file) return null;
              const asRendered = rendered.has(file.path);
              return (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only keeps clicks from bubbling; the buttons inside take the keyboard themselves.
                <span
                  className="flex items-center gap-0.5 font-sans text-foreground select-none"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
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
                            onClick={() => {
                              setRendered((s) =>
                                s.has(file.path)
                                  ? new Set([...s].filter((p) => p !== file.path))
                                  : new Set([...s, file.path]),
                              );
                            }}
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
                          onClick={() => {
                            setComposing({
                              path: file.path,
                              range: { start: 0, end: 0, side: "additions", endSide: "additions" },
                              file: true,
                            });
                          }}
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
                      <DropdownMenuItem
                        disabled={!link || !source}
                        onClick={() => void (link && source && copyPermalink(link, source, file.path))}
                      >
                        {t("diff.copyPermalink")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!link} onClick={() => void (link && copyDiffLink(link, file.path))}>
                        {t("diff.copyDiffLink")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!link || file.status === "removed"}
                        onClick={() => void (link && bridge.openUrl(permalink(link, link.head, file.path)))}
                      >
                        {t("diff.openFile")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <label className="flex items-center gap-1.5 px-1.5 py-1 text-body">
                    <Checkbox
                      checked={isViewed(file)}
                      onCheckedChange={(v) => {
                        props.onViewed(file, v);
                      }}
                      aria-label={t("review.viewedFile", { path: file.path })}
                      className="size-3.5"
                    />
                    {t("review.viewed")}
                  </label>
                </span>
              );
            }}
            renderAnnotation={(...[annotation]) => {
              const a = annotation.metadata;
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
                    onEdit={(body) => {
                      props.onEditDraft(a.draft.key, body);
                    }}
                    onRemove={() => void removeDraft(a.draft.key)}
                  />
                );
              if (a.kind === "finding")
                return (
                  <FindingView
                    finding={a.finding}
                    by={props.findingsBy}
                    onAdd={() => {
                      props.onAcceptFinding(a.finding, a.side);
                    }}
                    onDismiss={() => {
                      props.onDismissFinding(a.finding);
                    }}
                  />
                );
              return (
                <NewComment
                  lines={a.file ? t("review.theFile") : describe(a.range, t)}
                  path={a.path}
                  range={a.range}
                  file={a.file}
                  onAdd={(body) => {
                    props.onAddDraft(draftOf(a, body));
                    forget(pull, chatKey(a));
                  }}
                  onSendNow={async (body) => {
                    await props.onCommentNow(draftOf(a, body));
                    forget(pull, chatKey(a));
                  }}
                  onCancel={() => {
                    forget(pull, chatKey(a));
                  }}
                  chat={{ pull, key: chatKey(a) }}
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
              noPatch.length > 0 ? (
                <div className="flex flex-col gap-3 px-3 pb-6">
                  {noPatch.map((f) => {
                    const load = loaded.get(f.path);
                    return (
                      <NoPatchFile
                        key={f.path}
                        file={f}
                        source={source}
                        viewed={isViewed(f)}
                        loading={load?.state === "loading"}
                        error={load?.state === "error" ? load.message : null}
                        onViewed={(v) => {
                          props.onViewed(f, v);
                        }}
                        onLoad={load?.state === "error" && load.binary ? undefined : () => void loadFile(f)}
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
                disabled={!commentable}
                onClick={() => {
                  setComposing({
                    path: menuAt.path,
                    range: { start: menuAt.start, side: menuAt.startSide, end: menuAt.end, endSide: menuAt.side },
                  });
                }}
              >
                {t("diff.commentHere")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!link || !source || menuAt.startSide !== menuAt.side}
                onClick={() =>
                  void (
                    link &&
                    source &&
                    copyPermalink(link, source, menuAt.path, {
                      side: menuAt.side,
                      start: menuAt.start,
                      end: menuAt.end,
                    })
                  )
                }
              >
                {t("diff.copyPermalink")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!link} onClick={() => void (link && copyDiffLink(link, menuAt.path, menuAt))}>
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
}
