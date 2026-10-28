import type { FileDiffMetadata } from "@pierre/diffs";

import type { Thread } from "@/utils/review/review";

type Side = Thread["side"];

export function lineText(diff: FileDiffMetadata, side: Side, line: number): string | null {
  return rawLine(diff, side, line)?.replace(/\r?\n$/u, "") ?? null;
}

function rawLine(diff: FileDiffMetadata, side: Side, line: number): string | undefined {
  for (const h of diff.hunks) {
    const [start, count, index, lines] =
      side === "additions"
        ? [h.additionStart, h.additionCount, h.additionLineIndex, diff.additionLines]
        : [h.deletionStart, h.deletionCount, h.deletionLineIndex, diff.deletionLines];
    if (!diff.isPartial) return lines[line - 1];
    if (line >= start && line < start + count) return lines[index + line - start];
  }
  return undefined;
}

export function shows(diff: FileDiffMetadata, side: Side, line: number) {
  return diff.hunks.some((h) =>
    side === "additions"
      ? line >= h.additionStart && line < h.additionStart + h.additionCount
      : line >= h.deletionStart && line < h.deletionStart + h.deletionCount,
  );
}

const same = (a: string, b: string) => a.trimEnd() === b.trimEnd();

export type Placement = { side: Side; lineNumber: number; moved: boolean };

export function placeThread(
  diff: FileDiffMetadata,
  thread: Pick<Thread, "side" | "line" | "outdated" | "context">,
): Placement {
  const top = { side: thread.side, lineNumber: 0, moved: true };
  if (thread.line <= 0 || !shows(diff, thread.side, thread.line)) return top;
  if (!thread.outdated) return { side: thread.side, lineNumber: thread.line, moved: false };
  const text = lineText(diff, thread.side, thread.line);
  return thread.context !== undefined && text !== null && same(text, thread.context)
    ? { side: thread.side, lineNumber: thread.line, moved: false }
    : top;
}

export function hunkTail(diffHunk: string | null | undefined): string | undefined {
  if (!diffHunk) return undefined;
  let end = diffHunk.length;
  while (diffHunk[end - 1] === "\n") end--;
  const last = diffHunk.slice(0, end).split("\n").at(-1)!;
  return last.startsWith("@@") ? undefined : last.slice(1);
}

export function findingSide(diff: FileDiffMetadata, line: number): Side {
  return !shows(diff, "additions", line) && shows(diff, "deletions", line) ? "deletions" : "additions";
}
