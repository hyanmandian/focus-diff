/**
 * How the time a reader spends on a review is shared among its files, to learn their pace from. Only time they're
 * there counts: a still moment counts too, up to a limit, since reading a hard line through takes stillness; past the
 * limit they've likely stepped away. The time is shared by the files on screen, each by how much of the screen it
 * takes, so a short file read beside a long one gets its part. Each app watches for the activity its own way.
 */

/** The longest still moment counted as reading: time to think a tricky change through, short of leaving the desk. */
export const STILL_LIMIT_MS = 90_000;

/** The time spent on files between two moments of activity `gap` apart. */
export const creditFor = (gap: number): number => Math.max(0, Math.min(gap, STILL_LIMIT_MS));

/** Files on screen, and how much of it each takes, in pixels. */
export type OnScreen = [path: string, height: number][];

/** Shares `credit` among the files on screen by how much of it each takes. */
export const share = (credit: number, onScreen: OnScreen): OnScreen => {
  const total = onScreen.reduce((sum, [, height]) => sum + height, 0);
  return total > 0 ? onScreen.map(([path, height]) => [path, (credit * height) / total]) : [];
};
