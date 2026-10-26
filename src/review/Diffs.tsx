// The pull request's files as one virtualized list (@pierre/diffs' CodeView): sticky file headers
// with the size and a Viewed box, conversations and pending comments between the lines, and the
// "+" beside a line to comment on it. Viewed files fold away, as on GitHub.

import { getSingularPatch, type CodeViewDiffItem, type DiffLineAnnotation, type FileDiffMetadata, type SelectedLineRange } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { FileWarning, Plus } from "lucide-react";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Exchange, Finding } from "@/lib/ai";
import type { AiAnswer } from "@/lib/bridge";
import type { OnScreen } from "@/lib/estimate";
import type { Draft, ReviewFile, Thread } from "@/lib/review";
import { DraftView, FindingView, NewComment, ThreadView } from "./Thread";

type Annotation = { kind: "thread"; thread: Thread; moved: boolean } | { kind: "draft"; draft: Draft } | { kind: "finding"; finding: Finding } | { kind: "new"; path: string; range: SelectedLineRange };

export type DiffsHandle = {
  scrollToFile: (path: string) => void;
  scrollToLine: (path: string, line: number) => void;
  scrollToTop: () => void;
  /** The files on screen and how much of it each takes, for the time spent on them. */
  onScreen: () => OnScreen;
  /** The file at the top of the screen, and whether it's been brought all the way up. */
  atTop: () => { path: string; reached: boolean } | null;
};

type Props = {
  files: ReviewFile[];
  threads: Map<string, Thread[]>;
  drafts: Draft[];
  /** The AI review's comments on the diff's lines, and who made them. */
  findings: Finding[];
  findingsBy: string;
  onAcceptFinding: (finding: Finding) => void;
  /** Asks the AI about selected lines; null when there's no AI. */
  onAsk: ((path: string, range: SelectedLineRange, question: string, earlier: Exchange[]) => Promise<AiAnswer>) | null;
  onDismissFinding: (finding: Finding) => void;
  isViewed: (file: ReviewFile) => boolean;
  /** Viewed files opened anyway (to show a comment in one): they don't fold. */
  opened: Set<string>;
  diffStyle: "split" | "unified";
  wrap: boolean;
  dark: boolean;
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

const describe = (range: SelectedLineRange) => {
  const [a, b] = [Math.min(range.start, range.end), Math.max(range.start, range.end)];
  return a === b ? `line ${b}` : `lines ${a}–${b}`;
};

const toDraft = (path: string, range: SelectedLineRange, body: string): Omit<Draft, "key"> => ({
  path,
  side: range.endSide ?? range.side ?? "additions",
  line: Math.max(range.start, range.end),
  ...(range.start !== range.end ? { startLine: Math.min(range.start, range.end) } : {}),
  body,
});

/** Whether a line is one the diff shows (in a hunk) on that side. */
function shows(diff: FileDiffMetadata, side: Thread["side"], line: number) {
  return diff.hunks.some((h) => (side === "additions" ? line >= h.additionStart && line < h.additionStart + h.additionCount : line >= h.deletionStart && line < h.deletionStart + h.deletionCount));
}

/** The first line the diff shows. */
function firstLine(diff: FileDiffMetadata): { side: Thread["side"]; line: number } | null {
  const h = diff.hunks[0];
  if (!h) return null;
  return h.additionCount > 0 ? { side: "additions", line: h.additionStart } : { side: "deletions", line: h.deletionStart };
}

export const Diffs = forwardRef<DiffsHandle, Props>(function Diffs(props, ref) {
  const { files, threads, drafts, findings, isViewed, opened, diffStyle, wrap, dark } = props;
  const viewer = useRef<CodeViewHandle<Annotation, undefined>>(null);
  const [composing, setComposing] = useState<{ path: string; range: SelectedLineRange } | null>(null);
  // Parsing a patch is the costly part: once per file and patch.
  const parsed = useRef(new Map<string, { patch: string; diff: FileDiffMetadata }>());

  useImperativeHandle(ref, () => ({
    scrollToFile: (path) => viewer.current?.scrollTo({ type: "item", id: path, align: "start" } as never),
    scrollToLine: (path, line) => viewer.current?.scrollTo({ type: "line", id: path, lineNumber: line, side: "additions", align: "center", behavior: "smooth" } as never),
    scrollToTop: () => viewer.current?.scrollTo({ type: "position", position: 0 }),
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

  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const items = useMemo<Array<CodeViewDiffItem<Annotation>>>(() => {
    return files
      .filter((f) => f.patch)
      .map((f) => {
        let entry = parsed.current.get(f.path);
        if (!entry || entry.patch !== f.patch) {
          entry = { patch: f.patch, diff: getSingularPatch(f.patch) };
          parsed.current.set(f.path, entry);
        }
        const fileThreads = threads.get(f.path) ?? [];
        const fileDrafts = drafts.filter((d) => d.path === f.path);
        const fileFindings = findings.filter((x) => x.path === f.path && x.inDiff);
        const annotations: Array<DiffLineAnnotation<Annotation>> = [
          ...fileThreads.map((thread) => {
            // A comment on the file, or on a line this diff no longer shows (outdated), goes at
            // the top of the file, saying where it was, rather than nowhere.
            const here = thread.line > 0 && shows(entry.diff, thread.side, thread.line);
            const top = here ? null : firstLine(entry.diff);
            return { side: top?.side ?? thread.side, lineNumber: top?.line ?? thread.line, metadata: { kind: "thread" as const, thread, moved: !here } };
          }),
          ...fileDrafts.map((draft) => ({ side: draft.side, lineNumber: draft.line, metadata: { kind: "draft" as const, draft } })),
          ...fileFindings.map((finding) => ({ side: "additions" as const, lineNumber: finding.line, metadata: { kind: "finding" as const, finding } })),
          ...(composing?.path === f.path
            ? [{ side: composing.range.endSide ?? composing.range.side ?? "additions", lineNumber: Math.max(composing.range.start, composing.range.end), metadata: { kind: "new" as const, path: f.path, range: composing.range } }]
            : []),
        ];
        const viewed = isViewed(f) && !opened.has(f.path);
        return {
          id: f.path,
          type: "diff" as const,
          fileDiff: entry.diff,
          annotations,
          collapsed: viewed,
          version: version(
            JSON.stringify([
              viewed,
              fileThreads.map((t) => [t.id, t.resolved, t.comments.length]),
              fileDrafts.map((d) => [d.key, d.body]),
              fileFindings.map((x) => [x.line, x.body]),
              composing?.path === f.path ? composing.range : null,
            ]),
          ),
        };
      });
  }, [files, threads, drafts, findings, composing, isViewed, opened]);

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
      enableGutterUtility: true,
      layout: { paddingTop: 12, paddingBottom: 48, gap: 12 },
      // Selecting lines (dragging over their numbers) opens the same box: comment or ask.
      enableLineSelection: true,
      onLineSelectionEnd: (range: SelectedLineRange | null, latest?: { item?: { id: string } }) => {
        if (range && latest?.item) setComposing({ path: latest.item.id, range });
      },
    }),
    [diffStyle, wrap, dark],
  );

  const binary = files.filter((f) => !f.patch);

  return (
    <div
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
      <CodeView<Annotation, undefined>
        ref={viewer}
        items={items}
        className="min-h-0 flex-1"
        // Room at the end for the filter bar that floats over it.
        style={{ height: "100%", overflow: "auto", paddingBottom: 72 }}
        options={options as never}
        // The "+" beside a line: the library's own has no name for a screen reader; this one says
        // what it does. (Several lines: drag over their numbers.)
        renderGutterUtility={(getHovered, item) => (
          <button
            type="button"
            aria-label="Comment on this line"
            onClick={() => {
              const line = getHovered();
              if (!line) return;
              const side = ("side" in line ? line.side : "additions") as SelectedLineRange["side"];
              setComposing({ path: item.id, range: { start: line.lineNumber, end: line.lineNumber, side, endSide: side } });
            }}
            className="flex size-5 items-center justify-center rounded-[5px] bg-primary text-primary-foreground shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-transform hover:scale-110 motion-reduce:transition-none"
          >
            <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
          </button>
        )}
        renderHeaderMetadata={(item) => {
          const file = byPath.get(item.id);
          if (!file) return null;
          return (
            <span className="flex items-center font-sans text-foreground">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground" onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={isViewed(file)} onCheckedChange={(v) => props.onViewed(file, v)} aria-label={`Viewed ${file.path}`} />
                Viewed
              </label>
            </span>
          );
        }}
        renderAnnotation={(...[annotation]) => {
          const a = annotation.metadata as Annotation;
          if (a.kind === "thread") return <ThreadView thread={a.thread} moved={a.moved} onReply={(body) => props.onReply(a.thread, body)} onResolve={(resolved) => props.onResolve(a.thread, resolved)} />;
          if (a.kind === "draft") return <DraftView draft={a.draft} onEdit={(body) => props.onEditDraft(a.draft.key, body)} onRemove={() => props.onRemoveDraft(a.draft.key)} />;
          if (a.kind === "finding") return <FindingView finding={a.finding} by={props.findingsBy} onAdd={() => props.onAcceptFinding(a.finding)} onDismiss={() => props.onDismissFinding(a.finding)} />;
          return (
            <NewComment
              lines={describe(a.range)}
              onAdd={(body) => {
                props.onAddDraft(toDraft(a.path, a.range, body));
                setComposing(null);
              }}
              onSendNow={async (body) => {
                await props.onCommentNow(toDraft(a.path, a.range, body));
                setComposing(null);
              }}
              onCancel={() => setComposing(null)}
              ask={props.onAsk ? (question, earlier) => props.onAsk!(a.path, a.range, question, earlier) : null}
              askName={props.findingsBy}
            />
          );
        }}
        renderCodeViewFooter={() =>
          binary.length ? (
            <div className="flex flex-col gap-1 px-3 pb-6 font-sans text-sm text-muted-foreground">
              {binary.map((f) => (
                <p key={f.path} className="flex items-center gap-2">
                  <FileWarning className="size-4" /> <span className="font-mono text-xs">{f.path}</span> isn't shown here (binary, or too large for GitHub's diff).
                  {/* Still one to tick off, or the review never adds up. */}
                  <label className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-foreground/5 hover:text-foreground">
                    <Checkbox checked={isViewed(f)} onCheckedChange={(v) => props.onViewed(f, v)} aria-label={`Viewed ${f.path}`} />
                    Viewed
                  </label>
                </p>
              ))}
            </div>
          ) : null
        }
      />
    </div>
  );
});
