// What helps write a comment, as text: the @mention or #reference being typed (to complete it), and
// the Markdown that ⌘B, ⌘I, ⌘E and ⌘K wrap around a selection. Pure, so the field (review/Writer.tsx)
// stays about the field.

/** An @login or #number being typed, from its trigger to the caret. */
export type Token = { kind: "mention" | "reference"; query: string; start: number };

/** What's being typed at the caret, when it's something to complete: "@an" or "#12". Only after a
 *  space, a line's start or an opening bracket (so an email address isn't a mention), and never in
 *  code. */
export function tokenAt(text: string, caret: number): Token | null {
  let i = caret;
  while (i > 0 && /[\w-]/.test(text[i - 1]!)) i--;
  const trigger = text[i - 1];
  if (trigger !== "@" && trigger !== "#") return null;
  const before = text[i - 2];
  if (before !== undefined && !/[\s([{]/.test(before)) return null;
  const query = text.slice(i, caret);
  // GitHub's logins are 39 characters at most.
  if (query.length > 39 || inCode(text, i - 1)) return null;
  return { kind: trigger === "@" ? "mention" : "reference", query, start: i - 1 };
}

/** Whether a place in the text is inside `code` or a fenced block. */
function inCode(text: string, at: number) {
  const before = text.slice(0, at);
  const fences = before.match(/^ {0,3}(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

/** The text with the token replaced by what was picked (and a space after), and where the caret goes. */
export function complete(text: string, token: Token, caret: number, value: string): { text: string; caret: number } {
  const trigger = token.kind === "mention" ? "@" : "#";
  const insert = `${trigger}${value} `;
  // A space already there isn't doubled.
  const rest = text.slice(caret);
  const next = rest.startsWith(" ") ? insert.slice(0, -1) : insert;
  return { text: text.slice(0, token.start) + next + rest, caret: token.start + next.length + (rest.startsWith(" ") ? 1 : 0) };
}

export type Person = { login: string; name?: string | null; avatarUrl?: string };

/** The people whose login or name starts with what's typed (logins first, then names, then the
 *  rest that contain it), in the order given otherwise: the conversation's people come first. */
export function rankPeople<P extends Person>(people: P[], query: string, most = 8): P[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const unique = people.filter((p) => p.login && !seen.has(p.login.toLowerCase()) && seen.add(p.login.toLowerCase()));
  if (!q) return unique.slice(0, most);
  const score = (p: P) => {
    const login = p.login.toLowerCase();
    const names = (p.name ?? "").toLowerCase().split(/\s+/);
    if (login.startsWith(q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (login.includes(q) || (p.name ?? "").toLowerCase().includes(q)) return 2;
    return 3;
  };
  return unique
    .map((p, i) => ({ p, i, s: score(p) }))
    .filter((x) => x.s < 3)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, most)
    .map((x) => x.p);
}

/** A change to the text: what replaces `from`..`to`, and the selection after. */
export type Change = { from: number; to: number; insert: string; select: [number, number] };

/** ⌘B, ⌘I and ⌘E: the selection between ** (or _, or `), or the markers taken off when it already
 *  has them; with nothing selected, the caret between a new pair. */
export function wrap(text: string, start: number, end: number, kind: "bold" | "italic" | "code"): Change {
  const mark = { bold: "**", italic: "_", code: "`" }[kind];
  const selected = text.slice(start, end);
  // Already wrapped, inside or just outside the selection: unwrapped.
  if (selected.length >= mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, -mark.length);
    return { from: start, to: end, insert: inner, select: [start, start + inner.length] };
  }
  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return { from: start - mark.length, to: end + mark.length, insert: selected, select: [start - mark.length, end - mark.length] };
  }
  return { from: start, to: end, insert: `${mark}${selected}${mark}`, select: [start + mark.length, end + mark.length] };
}

/** ⌘K: the selection as a link's text with the caret on its address (a selected address becomes
 *  the address); pasting a link over selected words does the same with it. */
export function link(text: string, start: number, end: number, url = ""): Change {
  const selected = text.slice(start, end);
  if (!url && /^https?:\/\/\S+$/.test(selected)) {
    const insert = `[](${selected})`;
    return { from: start, to: end, insert, select: [start + 1, start + 1] };
  }
  const insert = `[${selected}](${url})`;
  const at = start + selected.length + 3;
  const caret = url ? start + insert.length : at;
  return { from: start, to: end, insert, select: [caret, caret] };
}

/** "> " before each line: quoting what someone said in a reply. */
export const quote = (text: string) =>
  `${text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}\n\n`;
