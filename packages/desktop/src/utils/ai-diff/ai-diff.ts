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

export function numbered(patch: string, context = 3): string {
  const out: string[] = [];
  for (const hunk of hunks(patch)) {
    const rows = spacingAsSame(hunk.rows);
    const removed = rows.filter((r) => r.sign === "-");
    if (!rows.some((r) => r.sign === "+")) {
      if (removed.length > 0)
        out.push(`@@ ${removed[0]!.now} (removes ${removed.length} line${removed.length === 1 ? "" : "s"} here)`);
      continue;
    }
    const changed = rows.map((r) => r.sign !== " ");
    const near = (i: number) => changed.slice(Math.max(0, i - context), i + context + 1).includes(true);
    let open = false;
    let first = true;
    for (const [i, row] of rows.entries()) {
      if (!near(i)) {
        open = false;
        continue;
      }
      if (!open) out.push(`@@ ${row.now}${first && hunk.fn ? ` ${hunk.fn}` : ""}`);
      open = true;
      first = false;
      out.push(row.sign === "-" ? `-${row.text}` : `${row.now} ${row.sign}${row.text}`);
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
  const blocks: Array<{ file: ReviewFile; text: string }> = [];
  for (const f of sorted) {
    const title =
      f.previousPath && f.previousPath !== f.path
        ? `## ${name(f.path)} (renamed from ${f.previousPath})`
        : `## ${name(f.path)}`;
    if (f.status === "removed") blocks.push({ file: f, text: `${title} (removed, ${f.deletions} lines)` });
    else if (isNoise(f.path) || !f.patch) hidden.push(counts(f));
    else blocks.push({ file: f, text: `${title}\n${numbered(f.patch, shape.context)}` });
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
