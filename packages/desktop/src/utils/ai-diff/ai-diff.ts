import type { ReviewFile } from "@/utils/review/review";

const NOISE = [
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|Podfile\.lock|go\.sum)$/u,
  /\.min\.(?:js|css)$|\.(?:map|snap)$/u,
  /(?:^|\/)(?:dist|vendor|node_modules|__snapshots__)\//u,
];

export const isNoise = (path: string) => NOISE.some((p) => p.test(path));

export function numbered(patch: string): string {
  const out: string[] = [];
  let header = "";
  let shown: string[] = [];
  let removed: string[] = [];
  let adds = false;
  let line = 0;
  let at = 0;
  const flush = () => {
    if (adds) out.push(header, "__new hunk__", ...shown, ...(removed.length > 0 ? ["__old hunk__", ...removed] : []));
    else if (removed.length > 0)
      out.push(header, `(removes ${removed.length} line${removed.length === 1 ? "" : "s"} before line ${at})`);
  };
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text);
    if (hunk) {
      flush();
      header = text;
      shown = [];
      removed = [];
      adds = false;
      line = Number(hunk[1]);
      continue;
    }
    if (!line || text.startsWith("\\")) continue;
    if (text.startsWith("-")) {
      if (removed.length === 0) at = line;
      removed.push(text);
      continue;
    }
    if (text.startsWith("+")) adds = true;
    else if (!text.startsWith(" ")) continue;
    shown.push(`${line++} ${text}`);
  }
  flush();
  return out.join("\n");
}

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
};

const counts = (f: ReviewFile) => `${f.path} (+${f.additions} -${f.deletions})`;

export function diffForAi(files: ReviewFile[], budget: number): string {
  const sorted = files.toSorted((a, b) => (a.path > b.path ? 1 : -1));
  const hidden: string[] = [];
  const blocks: Array<{ file: ReviewFile; text: string }> = [];
  for (const f of sorted) {
    const title =
      f.previousPath && f.previousPath !== f.path ? `## ${f.path} (renamed from ${f.previousPath})` : `## ${f.path}`;
    if (f.status === "removed") blocks.push({ file: f, text: `${title} (removed, ${f.deletions} lines)` });
    else if (isNoise(f.path) || !f.patch) hidden.push(counts(f));
    else blocks.push({ file: f, text: `${title}\n${numbered(f.patch)}` });
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
