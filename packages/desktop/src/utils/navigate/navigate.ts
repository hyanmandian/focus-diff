export function stepFile(
  paths: string[],
  atTop: { path: string; reached: boolean } | null,
  by: 1 | -1,
): string | undefined {
  if (paths.length === 0) return undefined;
  const at = atTop ? paths.indexOf(atTop.path) : -1;
  if (at < 0) return by === 1 ? paths[0] : paths.at(-1);
  if (by === -1 && !atTop!.reached) return paths[at];
  return paths[Math.min(paths.length - 1, Math.max(0, at + by))];
}
