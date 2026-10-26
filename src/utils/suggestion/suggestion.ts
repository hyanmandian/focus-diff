// Suggested changes, as GitHub has them: a ```suggestion block in a comment on lines replaces those
// lines with its own. Building one from the lines picked, reading them back from a comment, and
// applying them to a file's text, for committing (one, or a batch) to the pull request's branch.

/** A ```suggestion block that starts as the lines themselves, to edit from. Its fence is longer
 *  than any run of backticks in them, so code with fences of its own can't close it early. */
export function suggestionBlock(lines: string[]): string {
  const longest = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/gu) ?? []).map((run) => run.length)));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}suggestion\n${lines.length > 0 ? `${lines.join("\n")}\n` : ""}${fence}`;
}

/** What each ```suggestion block in a comment's markdown replaces its lines with (none: removes
 *  them). An unclosed block runs to the end, as Markdown reads it. */
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
    // Any fenced block opens here, so a suggestion inside another code block isn't one.
    const start = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/u);
    if (start) open = { fence: start[1]!, lines: [], suggestion: start[2] === "suggestion" };
  }
  if (open?.suggestion) found.push(open.lines);
  return found;
}

/** Lines of a file at the pull request's head, numbered from 1, replaced by others. */
export type Edit = { start: number; end: number; lines: string[] };

export class SuggestionError extends Error {
  constructor(readonly reason: "overlap" | "outside") {
    super(reason);
  }
}

/** The file with each edit made. Its line endings and final newline stay as they were. Throws a
 *  SuggestionError when two edits touch the same lines or one is past the file's end (the file
 *  changed under the comment). */
export function applyEdits(content: string, edits: Edit[]): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(eol);
  // A final newline makes an empty last piece that's no line of its own.
  const count = content.endsWith(eol) ? lines.length - 1 : lines.length;
  const sorted = edits.toSorted((a, b) => a.start - b.start);
  for (const [i, edit] of sorted.entries()) {
    if (edit.start < 1 || edit.end < edit.start || edit.end > count) throw new SuggestionError("outside");
    if (i > 0 && edit.start <= sorted[i - 1]!.end) throw new SuggestionError("overlap");
  }
  // From the bottom up, so each edit's line numbers still hold.
  for (const edit of sorted.toReversed()) lines.splice(edit.start - 1, edit.end - edit.start + 1, ...edit.lines);
  return lines.join(eol);
}

/** The lines `start` to `end` of one side of a file, from its patch; null when the patch doesn't
 *  show them all (outside its hunks). */
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

/** Someone whose suggestion went into a commit, credited the way GitHub does it. */
export type Author = { login: string; name?: string | null; databaseId?: number | null };

/** "Co-authored-by" lines for the suggestions' authors, as GitHub writes them: their no-reply
 *  address, once each, never the one committing. Bots and the deleted (no id) are left out. */
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

/** UTF-8 text as base64, which a commit's file contents go to GitHub in. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // In pieces: one call per byte of a large file would overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCodePoint(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
