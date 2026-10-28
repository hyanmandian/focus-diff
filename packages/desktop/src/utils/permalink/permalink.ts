type Side = "additions" | "deletions";
type Repo = { owner: string; repo: string };

const segments = (path: string) =>
  path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

export function linesAnchor(start: number, end = start) {
  const [a, b] = [Math.min(start, end), Math.max(start, end)];
  return a === b ? `#L${a}` : `#L${a}-L${b}`;
}

export function permalink(r: Repo, sha: string, path: string, lines?: { start: number; end?: number }) {
  return `https://github.com/${r.owner}/${r.repo}/blob/${sha}/${segments(path)}${lines && lines.start > 0 ? linesAnchor(lines.start, lines.end) : ""}`;
}

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function diffLines(side: Side, start: number, end = start, startSide: Side = side) {
  const letter = (s: Side) => (s === "deletions" ? "L" : "R");
  return start === end && startSide === side
    ? `${letter(side)}${end}`
    : `${letter(startSide)}${start}-${letter(side)}${end}`;
}

export async function diffLink(
  r: Repo & { number: number },
  path: string,
  lines?: { side: Side; start: number; end?: number; startSide?: Side },
) {
  const anchor = `diff-${await sha256(path)}${lines && lines.start > 0 ? diffLines(lines.side, lines.start, lines.end, lines.startSide) : ""}`;
  return `https://github.com/${r.owner}/${r.repo}/pull/${r.number}/files#${anchor}`;
}
