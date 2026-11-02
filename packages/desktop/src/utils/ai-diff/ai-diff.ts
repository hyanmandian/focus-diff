import type { ReviewFile } from "@/utils/review/review";

const NOISE = [
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|Podfile\.lock|go\.sum)$/u,
  /\.min\.(?:js|css)$|\.(?:map|snap)$/u,
  /(?:^|\/)(?:dist|vendor|node_modules|__snapshots__)\//u,
];

export const isNoise = (path: string) => NOISE.some((p) => p.test(path));

type Row = { sign: " " | "+" | "-"; text: string; now: number };
type Hunk = { fn: string; rows: Row[] };

function hunks(patch: string): Hunk[] {
  const out: Hunk[] = [];
  let line = 0;
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/u.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      out.push({ fn: hunk[2]!.trim(), rows: [] });
      continue;
    }
    const sign = text[0];
    if (!line || (sign !== " " && sign !== "+" && sign !== "-")) continue;
    out.at(-1)!.rows.push({ sign, text: text.slice(1), now: line });
    if (sign !== "-") line++;
  }
  return out;
}

const bare = (rows: Row[]) => rows.map((r) => r.text.replaceAll(/\s+/gu, "")).join("");

function spacingAsSame(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i]!.sign === " ") {
      out.push(rows[i++]!);
      continue;
    }
    const removed: Row[] = [];
    const added: Row[] = [];
    while (rows[i]?.sign === "-") removed.push(rows[i++]!);
    while (rows[i]?.sign === "+") added.push(rows[i++]!);
    if (removed.length > 0 && added.length > 0 && bare(removed) === bare(added))
      out.push(...added.map((r): Row => ({ ...r, sign: " " })));
    else out.push(...removed, ...added);
  }
  return out;
}

const MOVE_RUN = 3;
const MOVE_LINE = 8;

export type Moves = { added: ReadonlySet<string>; removed: ReadonlySet<string> };

const moveKey = (text: string) => {
  const key = text.replaceAll(/\s+/gu, "");
  return key.length >= MOVE_LINE ? key : null;
};

export function moves(patches: string[]): Moves {
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const patch of patches)
    for (const hunk of hunks(patch))
      for (const row of spacingAsSame(hunk.rows)) {
        const key = row.sign === " " ? null : moveKey(row.text);
        if (key) (row.sign === "+" ? added : removed).add(key);
      }
  return { added, removed };
}

type Item = { row: Row; moved: number; last: Row };

function collapse(rows: Row[], found: Moves | undefined): Item[] {
  const movable = rows.map((row) => {
    const key = moveKey(row.text);
    const other = row.sign === "+" ? found?.removed : found?.added;
    return row.sign !== " " && key !== null && Boolean(other?.has(key));
  });
  const items: Item[] = [];
  for (let i = 0; i < rows.length;) {
    let end = i;
    while (movable[end] && rows[end]!.sign === rows[i]!.sign) end++;
    if (end - i >= MOVE_RUN) {
      items.push({ row: rows[i]!, moved: end - i, last: rows[end - 1]! });
      i = end;
    } else {
      items.push({ row: rows[i]!, moved: 0, last: rows[i]! });
      i++;
    }
  }
  return items;
}

const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

export function numbered(patch: string, context = 3, found?: Moves): string {
  const out: string[] = [];
  for (const hunk of hunks(patch)) {
    const items = collapse(spacingAsSame(hunk.rows), found);
    const removed = items.filter((it) => it.row.sign === "-");
    if (!items.some((it) => it.row.sign === "+")) {
      if (removed.length > 0) {
        const lines = removed.reduce((sum, it) => sum + Math.max(1, it.moved), 0);
        const moved = removed.reduce((sum, it) => sum + it.moved, 0);
        const said =
          moved === lines
            ? `moves ${plural(lines)} elsewhere in the diff`
            : `removes ${plural(lines)} here${moved > 0 ? `, ${moved} of them moved elsewhere in the diff` : ""}`;
        out.push(`@@ ${removed[0]!.row.now} (${said})`);
      }
      continue;
    }
    const changed = items.map((it) => it.row.sign !== " " && it.moved === 0);
    const near = (i: number) =>
      items[i]!.moved > 0 || changed.slice(Math.max(0, i - context), i + context + 1).includes(true);
    let open = false;
    let first = true;
    for (const [i, { row, moved, last }] of items.entries()) {
      if (!near(i)) {
        open = false;
        continue;
      }
      if (!open) out.push(`@@ ${row.now}${first && hunk.fn ? ` ${hunk.fn}` : ""}`);
      open = true;
      first = false;
      if (moved > 0)
        out.push(
          row.sign === "-"
            ? `-(${plural(moved)} moved elsewhere in the diff)`
            : `${row.now}-${last.now} +(${plural(moved)} moved here unchanged)`,
        );
      else out.push(row.sign === "-" ? `-${row.text}` : `${row.now} ${row.sign}${row.text}`);
    }
  }
  return out.join("\n");
}

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
};

type Shape = { ids?: ReadonlyMap<string, number> | undefined; context?: number | undefined };

export function diffForAi(files: ReviewFile[], budget: number, shape: Shape = {}): string {
  const name = (path: string) => (shape.ids?.has(path) ? `[${shape.ids.get(path)!}] ${path}` : path);
  const counts = (f: ReviewFile) => `${name(f.path)} (+${f.additions} -${f.deletions})`;
  const sorted = files.toSorted((a, b) => (a.path > b.path ? 1 : -1));
  const hidden: string[] = [];
  const found = moves(sorted.filter((f) => !isNoise(f.path)).map((f) => f.patch));
  const blocks: Array<{ file: ReviewFile; text: string }> = [];
  for (const f of sorted) {
    const title =
      f.previousPath && f.previousPath !== f.path
        ? `## ${name(f.path)} (renamed from ${f.previousPath})`
        : `## ${name(f.path)}`;
    if (f.status === "removed") blocks.push({ file: f, text: `${title} (removed, ${f.deletions} lines)` });
    else if (isNoise(f.path) || !f.patch) hidden.push(counts(f));
    else {
      const body = numbered(f.patch, shape.context, found);
      blocks.push({ file: f, text: body ? `${title}\n${body}` : `${title} (only spacing changed)` });
    }
  }
  const weight = new Map<string, number>();
  for (const { file } of blocks)
    weight.set(extension(file.path), (weight.get(extension(file.path)) ?? 0) + file.additions + file.deletions);
  const top = Math.max(0, ...weight.values());
  const main = (f: ReviewFile) => weight.get(extension(f.path))! * 2 >= top;
  let size = blocks.reduce((sum, b) => sum + b.text.length + 2, 0);
  const dropped = new Set<ReviewFile>();
  const cost = (b: { file: ReviewFile; text: string }) => b.text.length * (main(b.file) ? 1 : 2);
  const candidates = blocks.toSorted((a, b) => cost(b) - cost(a));
  for (const { file, text } of candidates) {
    if (size <= budget) break;
    dropped.add(file);
    size -= text.length + 2;
  }
  return [
    blocks
      .filter((b) => !dropped.has(b.file))
      .map((b) => b.text)
      .join("\n\n"),
    hidden.length > 0
      ? `Not shown (lockfiles, generated, binary or too large):\n${hidden.map((h) => `- ${h}`).join("\n")}`
      : "",
    dropped.size > 0
      ? `Left out to fit (ask about them by name):\n${sorted
          .filter((f) => dropped.has(f))
          .map((f) => `- ${counts(f)}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function descriptionText(html: string): string {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const box of body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    const item = box.closest("li");
    if (item && !item.textContent.trim()) item.remove();
    else box.replaceWith(box.checked ? "[x]" : "[ ]");
  }
  let text = body.textContent;
  for (let last = ""; last !== text;) {
    last = text;
    text = text.replaceAll(/<!--[\s\S]*?-->/gu, "");
  }
  return text.replaceAll(/\n{3,}/gu, "\n\n").trim();
}
