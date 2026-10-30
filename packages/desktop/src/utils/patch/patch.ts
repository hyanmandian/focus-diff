export type PatchLine = { text: string; kind: string | undefined; old: number; now: number };

export function* patchLines(patch: string): Generator<PatchLine> {
  let old = 0;
  let now = 0;
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text);
    if (hunk) {
      old = Number(hunk[1]);
      now = Number(hunk[2]);
      continue;
    }
    if (!now || text.startsWith("\\")) continue;
    const kind = text[0];
    yield { text, kind, old, now };
    if (kind === "+") now++;
    else if (kind === "-") old++;
    else {
      now++;
      old++;
    }
  }
}
