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
