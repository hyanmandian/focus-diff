import changelog from "../../../CHANGELOG.md?raw";

type Change = { kind: "feature" | "fix"; text: string };
export type Release = { version: string; date: string; changes: Change[] };

const HEADING = /^## \[?(\d+\.\d+\.\d+)\]?(?:\([^)]*\))?\s*\((\d{4}-\d{2}-\d{2})\)/u;

export function parse(text: string): Release[] {
  const releases: Release[] = [];
  let kind: Change["kind"] | null = null;
  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      releases.push({ version: heading[1]!, date: heading[2]!, changes: [] });
      kind = null;
    } else if (line.startsWith("### ")) {
      kind = /feature/iu.test(line) ? "feature" : /fix/iu.test(line) ? "fix" : null;
    } else if (line.startsWith("* ") && kind && releases.length > 0) {
      const said = line
        .slice(2)
        .replace(/^\*\*[^*]+:\*\*\s*/u, "")
        .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)\s*$/u, "")
        .trim();
      const release = releases.at(-1)!;
      const entry = said.charAt(0).toUpperCase() + said.slice(1);
      if (said && !release.changes.some((c) => c.text === entry)) release.changes.push({ kind, text: entry });
    }
  }
  return releases.filter((r) => r.changes.length > 0);
}

const parts = (version: string) => version.split(".").map(Number);

export function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export function releasesBetween(after: string | null, upTo: string, from = changelog): Release[] {
  return parse(from).filter((r) => !newer(r.version, upTo) && (!after || newer(r.version, after)));
}

export const releaseUrl = (version: string) =>
  `https://github.com/hyanmandian/focus-diff/releases/tag/desktop-v${version}`;

const SEEN = "seen-version";

export function updatedFrom(current: string): string | null {
  try {
    const seen = localStorage.getItem(SEEN);
    if (!seen) localStorage.setItem(SEEN, current);
    return seen && newer(current, seen) ? seen : null;
  } catch {
    return null;
  }
}

export function sawNews(current: string) {
  try {
    localStorage.setItem(SEEN, current);
  } catch {}
}
