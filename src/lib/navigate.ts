// Stepping from file to file in the Diff, as j and k do on GitHub: from the file at the top of the
// screen to the next, or back to the start of the one being read (if it's scrolled partway), then
// the one before.

/** `atTop`: the file at the top of the screen, and whether its start is there (Diffs.atTop). */
export function stepFile(paths: string[], atTop: { path: string; reached: boolean } | null, by: 1 | -1): string | undefined {
  if (!paths.length) return undefined;
  const at = atTop ? paths.indexOf(atTop.path) : -1;
  if (at < 0) return by === 1 ? paths[0] : paths[paths.length - 1];
  if (by === -1 && !atTop!.reached) return paths[at];
  return paths[Math.min(paths.length - 1, Math.max(0, at + by))];
}
