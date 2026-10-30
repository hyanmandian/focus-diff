export type Token = { kind: "mention" | "reference" | "emoji"; query: string; start: number };

const TRIGGERS = { "@": "mention", "#": "reference", ":": "emoji" } as const;

export function tokenAt(text: string, caret: number): Token | null {
  let i = caret;
  while (i > 0 && /[\w+-]/u.test(text[i - 1]!)) i--;
  const trigger = text[i - 1];
  if (trigger !== "@" && trigger !== "#" && trigger !== ":") return null;
  const before = text[i - 2];
  if (before !== undefined && !/[\s([{]/u.test(before)) return null;
  const query = text.slice(i, caret);
  if (query.length > 39 || inCode(text, i - 1)) return null;
  if (trigger === ":" ? !/^[a-z0-9_+-]{2,}$/iu.test(query) : query.includes("+")) return null;
  return { kind: TRIGGERS[trigger], query, start: i - 1 };
}

function inCode(text: string, at: number) {
  const before = text.slice(0, at);
  const fences = before.match(/^ {0,3}(```|~~~)/gmu)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (line.match(/`/gu)?.length ?? 0) % 2 === 1;
}

export function complete(text: string, token: Token, caret: number, value: string): { text: string; caret: number } {
  const insert = token.kind === "emoji" ? `:${value}: ` : `${token.kind === "mention" ? "@" : "#"}${value} `;
  const rest = text.slice(caret);
  const next = rest.startsWith(" ") ? insert.slice(0, -1) : insert;
  return {
    text: text.slice(0, token.start) + next + rest,
    caret: token.start + next.length + (rest.startsWith(" ") ? 1 : 0),
  };
}

export type Person = { login: string; name?: string | null | undefined; avatarUrl?: string | undefined };

export function rankPeople<P extends Person>(people: P[], query: string, most = 8): P[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const unique = people.filter((p) => p.login && !seen.has(p.login.toLowerCase()) && seen.add(p.login.toLowerCase()));
  if (!q) return unique.slice(0, most);
  const score = (p: P) => {
    const login = p.login.toLowerCase();
    const names = (p.name ?? "").toLowerCase().split(/\s+/u);
    if (login.startsWith(q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (login.includes(q) || (p.name ?? "").toLowerCase().includes(q)) return 2;
    return 3;
  };
  return unique
    .map((p, i) => ({ p, i, s: score(p) }))
    .filter((x) => x.s < 3)
    .toSorted((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, most)
    .map((x) => x.p);
}

export type Change = { from: number; to: number; insert: string; select: [number, number] };

export function wrap(text: string, start: number, end: number, kind: "bold" | "italic" | "code"): Change {
  const mark = { bold: "**", italic: "_", code: "`" }[kind];
  const selected = text.slice(start, end);
  if (selected.length >= mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(mark.length, -mark.length);
    return { from: start, to: end, insert: inner, select: [start, start + inner.length] };
  }
  if (text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark) {
    return {
      from: start - mark.length,
      to: end + mark.length,
      insert: selected,
      select: [start - mark.length, end - mark.length],
    };
  }
  return {
    from: start,
    to: end,
    insert: `${mark}${selected}${mark}`,
    select: [start + mark.length, end + mark.length],
  };
}

export function link(text: string, start: number, end: number, url = ""): Change {
  const selected = text.slice(start, end);
  if (!url && /^https?:\/\/\S+$/u.test(selected)) {
    const insert = `[](${selected})`;
    return { from: start, to: end, insert, select: [start + 1, start + 1] };
  }
  const insert = `[${selected}](${url})`;
  const at = start + selected.length + 3;
  const caret = url ? start + insert.length : at;
  return { from: start, to: end, insert, select: [caret, caret] };
}

export const quote = (text: string) =>
  `${text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}\n\n`;

export type Emoji = { name: string; char: string };

export function emojiList(pictures: Record<string, string>): Emoji[] {
  const list: Emoji[] = [];
  for (const [name, url] of Object.entries(pictures)) {
    const code = /\/unicode\/([0-9a-f-]+)\.png/iu.exec(url)?.[1];
    if (!code) continue;
    try {
      list.push({ name, char: String.fromCodePoint(...code.split("-").map((h) => parseInt(h, 16))) });
    } catch {}
  }
  return list;
}

export function rankEmoji(list: Emoji[], query: string, limit = 8): Emoji[] {
  const q = query.toLowerCase();
  const starts = list.filter((e) => e.name.startsWith(q));
  const within = list.filter((e) => !e.name.startsWith(q) && e.name.includes(q));
  const byLength = (a: Emoji, b: Emoji) => a.name.length - b.name.length || a.name.localeCompare(b.name);
  return [...starts.toSorted(byLength), ...within.toSorted(byLength)].slice(0, limit);
}
