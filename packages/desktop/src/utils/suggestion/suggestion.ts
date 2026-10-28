export function suggestionBlock(lines: string[]): string {
  const longest = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/gu) ?? []).map((run) => run.length)));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}suggestion\n${lines.length > 0 ? `${lines.join("\n")}\n` : ""}${fence}`;
}

export function suggestionsIn(markdown: string): string[][] {
  const found: string[][] = [];
  const lines = markdown.replaceAll(/\r\n?/gu, "\n").split("\n");
  let open: { fence: string; lines: string[]; suggestion: boolean } | null = null;
  for (const line of lines) {
    if (open) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u);
      if (close && close[1]![0] === open.fence[0] && close[1]!.length >= open.fence.length) {
        if (open.suggestion) found.push(open.lines);
        open = null;
      } else open.lines.push(line);
      continue;
    }
    const start = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/u);
    if (start) open = { fence: start[1]!, lines: [], suggestion: start[2] === "suggestion" };
  }
  if (open?.suggestion) found.push(open.lines);
  return found;
}

export type Edit = { start: number; end: number; lines: string[] };

export class SuggestionError extends Error {
  constructor(readonly reason: "overlap" | "outside") {
    super(reason);
  }
}

export function applyEdits(content: string, edits: Edit[]): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(eol);
  const count = content.endsWith(eol) ? lines.length - 1 : lines.length;
  const sorted = edits.toSorted((a, b) => a.start - b.start);
  for (const [i, edit] of sorted.entries()) {
    if (edit.start < 1 || edit.end < edit.start || edit.end > count) throw new SuggestionError("outside");
    if (i > 0 && edit.start <= sorted[i - 1]!.end) throw new SuggestionError("overlap");
  }
  for (const edit of sorted.toReversed()) lines.splice(edit.start - 1, edit.end - edit.start + 1, ...edit.lines);
  return lines.join(eol);
}

export function linesFromPatch(
  patch: string,
  start: number,
  end: number,
  side: "additions" | "deletions",
): string[] | null {
  const found = new Map<number, string>();
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    const mark = line[0];
    const text = line.slice(1);
    if (mark === " ") {
      if (side === "additions") found.set(newLine, text);
      else found.set(oldLine, text);
      oldLine++;
      newLine++;
    } else if (mark === "+") {
      if (side === "additions") found.set(newLine, text);
      newLine++;
    } else if (mark === "-") {
      if (side === "deletions") found.set(oldLine, text);
      oldLine++;
    }
  }
  const lines: string[] = [];
  for (let n = start; n <= end; n++) {
    const text = found.get(n);
    if (text === undefined) return null;
    lines.push(text);
  }
  return lines;
}

export type Author = { login: string; name?: string | null; databaseId?: number | null };

export function coAuthors(authors: Author[], me: string | null): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const a of authors) {
    if (!a.databaseId || a.login === me || seen.has(a.login)) continue;
    seen.add(a.login);
    lines.push(
      `Co-authored-by: ${(a.name ?? "").trim() || a.login} <${a.databaseId}+${a.login}@users.noreply.github.com>`,
    );
  }
  return lines;
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCodePoint(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
