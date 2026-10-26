// Hiding whitespace changes (GitHub's "Hide whitespace", git diff -w), worked out from the patch
// alone, with nothing more to fetch: within each run of removed and added lines, the lines that
// are the same once all whitespace is taken out pair up and show as unchanged (in their new form).
// Line numbers stay as they are, so comments still land where they were made. A hunk left with no
// changes goes; a file whose changes were all whitespace keeps its hunks, unchanged, rather than
// showing nothing.

/** Past this many line pairs in one run, lines pair only in order (no full search). */
const LARGEST = 4_000_000;

const bare = (line: string) => line.slice(1).replaceAll(/\s+/gu, "");

/** The removed and added lines of one run, as unchanged pairs and what's left, in order. */
function pairUp(removed: string[], added: string[]): string[] {
  const a = removed.map((line) => bare(line));
  const b = added.map((line) => bare(line));
  // Which added line each removed line pairs with: the longest run of lines both share (the
  // classic table, read back from the start), or, for a huge run, only lines at the same place.
  const pairs = new Map<number, number>();
  if (a.length * b.length > LARGEST) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) pairs.set(i, i);
  } else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (a[i] === b[j]) pairs.set(i++, j++);
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
      else j++;
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  // Between two pairs, the removed lines first, then the added, as git writes them.
  for (const [pi, pj] of [...pairs, [a.length, b.length] as const]) {
    while (i < pi) out.push(removed[i++]!);
    while (j < pj) out.push(added[j++]!);
    if (pi < a.length) {
      out.push(` ${added[pj]!.slice(1)}`);
      i++;
      j++;
    }
  }
  return out;
}

export function ignoreWhitespace(patch: string): string {
  const lines = patch.replace(/\n$/u, "").split("\n");
  const head: string[] = [];
  const hunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("@@")) hunks.push([line]);
    else if (hunks.length > 0) hunks.at(-1)!.push(line);
    else head.push(line);
  }
  const changed = hunks.map((hunk) => {
    const out = [hunk[0]!];
    let run: string[] = [];
    // "\ No newline at end of file" belongs to the line before it: a run with one stays as it is.
    const end = () => {
      out.push(
        ...(run.some((l) => l[0] === "\\")
          ? run
          : pairUp(
              run.filter((l) => l[0] === "-"),
              run.filter((l) => l[0] === "+"),
            )),
      );
      run = [];
    };
    for (const line of hunk.slice(1)) {
      if (line[0] === "-" || line[0] === "+" || (line[0] === "\\" && run.length > 0)) run.push(line);
      else {
        end();
        out.push(line);
      }
    }
    end();
    return out;
  });
  const kept = changed.filter((hunk) => hunk.some((l) => l[0] === "+" || l[0] === "-"));
  if (kept.length === 0) return patch;
  return `${[...head, ...kept.flat()].join("\n")}\n`;
}
