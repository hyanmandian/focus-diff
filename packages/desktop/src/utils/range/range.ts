// Lines picked in the diff, as GitHub takes them for a comment: the last line and its side, and,
// for several, the first line and its own side. Dragged up or down, the earlier line is the start;
// across the two sides, the old version's line comes first (GitHub refuses a range that starts on
// the new side and ends on the old).

import type { SelectedLineRange } from "@pierre/diffs";

type Side = "additions" | "deletions";

type LineRange = { side: Side; line: number; startSide?: Side; startLine?: number };

export function lineRange(range: SelectedLineRange): LineRange {
  const a = { side: range.side ?? range.endSide ?? "additions", line: range.start };
  const b = { side: range.endSide ?? range.side ?? "additions", line: range.end };
  const [first, last] =
    a.side === b.side ? (a.line <= b.line ? [a, b] : [b, a]) : a.side === "deletions" ? [a, b] : [b, a];
  if (first.side === last.side && first.line === last.line) return { side: last.side, line: last.line };
  return { side: last.side, line: last.line, startSide: first.side, startLine: first.line };
}
