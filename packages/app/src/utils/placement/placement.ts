// Where a conversation goes in a file's diff. One on a line the diff shows sits there; one on the
// file as a whole, or outdated (made on an earlier version), goes at the top of the file saying
// where it was, unless the diff still shows that very line of code where it was made. An outdated
// thread's line number is from the version it was made on: on today's diff the same number may be
// unrelated code, so the number alone never places it.

import type { FileDiffMetadata } from "@pierre/diffs";

import type { Thread } from "../review/review";

type Side = Thread["side"];

/** The text of a line the diff shows, on that side (without its line ending); null when no hunk
 *  shows it. */
export function lineText(diff: FileDiffMetadata, side: Side, line: number): string | null {
  return rawLine(diff, side, line)?.replace(/\r?\n$/u, "") ?? null;
}

function rawLine(diff: FileDiffMetadata, side: Side, line: number): string | undefined {
  for (const h of diff.hunks) {
    const [start, count, index, lines] =
      side === "additions"
        ? [h.additionStart, h.additionCount, h.additionLineIndex, diff.additionLines]
        : [h.deletionStart, h.deletionCount, h.deletionLineIndex, diff.deletionLines];
    // A full file (hydrated, or made from both versions) holds every line at its own place.
    if (!diff.isPartial) return lines[line - 1];
    if (line >= start && line < start + count) return lines[index + line - start];
  }
  return undefined;
}

/** Whether a line is one the diff shows (in a hunk) on that side. */
export function shows(diff: FileDiffMetadata, side: Side, line: number) {
  return diff.hunks.some((h) =>
    side === "additions"
      ? line >= h.additionStart && line < h.additionStart + h.additionCount
      : line >= h.deletionStart && line < h.deletionStart + h.deletionCount,
  );
}

/** Lines compared as code: the line ending and trailing spaces don't count. */
const same = (a: string, b: string) => a.replace(/\s+$/u, "") === b.replace(/\s+$/u, "");

/** `lineNumber` 0: the top of the file. `moved`: not at its line, so it says where it was. */
export type Placement = { side: Side; lineNumber: number; moved: boolean };

export function placeThread(
  diff: FileDiffMetadata,
  thread: Pick<Thread, "side" | "line" | "outdated" | "context">,
): Placement {
  const top = { side: thread.side, lineNumber: 0, moved: true };
  if (thread.line <= 0 || !shows(diff, thread.side, thread.line)) return top;
  if (!thread.outdated) return { side: thread.side, lineNumber: thread.line, moved: false };
  // Outdated: only where the line it was made on is still the same code.
  const text = lineText(diff, thread.side, thread.line);
  return thread.context !== undefined && text !== null && same(text, thread.context)
    ? { side: thread.side, lineNumber: thread.line, moved: false }
    : top;
}

/** The commented line's text, from GitHub's diffHunk of the comment: its last line, without the
 *  +, - or space in front. */
export function hunkTail(diffHunk: string | null | undefined): string | undefined {
  if (!diffHunk) return undefined;
  const last = diffHunk.replace(/\n+$/u, "").split("\n").at(-1)!;
  return last.startsWith("@@") ? undefined : last.slice(1);
}

/** Which side an AI comment goes on: it names a line of the new version, so the additions, unless
 *  only the old version's side shows that number (a deleted file, or a deletions-only hunk). */
export function findingSide(diff: FileDiffMetadata, line: number): Side {
  return !shows(diff, "additions", line) && shows(diff, "deletions", line) ? "deletions" : "additions";
}
