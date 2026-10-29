const STILL_LIMIT_MS = 90_000;

export const creditFor = (gap: number): number => Math.max(0, Math.min(gap, STILL_LIMIT_MS));

export type OnScreen = [path: string, height: number][];

export const share = (credit: number, onScreen: OnScreen): OnScreen => {
  const total = onScreen.reduce((sum, [, height]) => sum + height, 0);
  return total > 0 ? onScreen.map(([path, height]) => [path, (credit * height) / total]) : [];
};
