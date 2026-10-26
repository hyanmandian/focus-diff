import type { ContentScriptContext } from "#imports";

/**
 * How long the reader actually spends on each file of a pull request, to learn their pace from. Only time they're
 * there counts: the page in view and something happening, a scroll, a key, the mouse. A still moment counts too, up to
 * a limit, since reading a hard line through takes stillness; past the limit they've likely stepped away, and the rest
 * of it doesn't count. The time is shared by the files on screen, each by how much of the screen it takes, so a short
 * file read beside a long one gets its part.
 */

/** The longest still moment counted as reading: time to think a tricky change through, short of leaving the desk. */
const STILL_LIMIT_MS = 90_000;
/** Activity is taken in at most this often; a moving mouse fires many times a second. */
const SAMPLE_MS = 1000;
const EVENTS = ["scroll", "wheel", "keydown", "pointerdown", "pointermove", "selectionchange"] as const;

/** The time spent on a file between two moments of activity `gap` apart. */
export const creditFor = (gap: number): number => Math.max(0, Math.min(gap, STILL_LIMIT_MS));

/** A file on screen, and how much of the screen it takes, in pixels. */
export type OnScreen = [path: string, height: number][];

/** Shares `credit` among the files on screen by how much of it each takes. */
export const share = (credit: number, onScreen: OnScreen): OnScreen => {
  const total = onScreen.reduce((sum, [, height]) => sum + height, 0);
  return total > 0 ? onScreen.map(([path, height]) => [path, (credit * height) / total]) : [];
};

export const createActiveTime = (ctx: ContentScriptContext, filesOnScreen: () => OnScreen) => {
  const spent = new Map<string, number>();
  let pathname = location.pathname;
  let last = 0;
  let current: OnScreen = [];

  /** Gives the time since the last moment of activity to the files on screen since then. */
  const settle = (now: number) => {
    if (!last) return;
    for (const [path, part] of share(creditFor(now - last), current)) spent.set(path, (spent.get(path) ?? 0) + part);
  };

  const sample = (now = Date.now()) => {
    if (location.pathname !== pathname) {
      pathname = location.pathname;
      spent.clear();
      last = 0;
      current = [];
    }
    if (document.hidden) return;
    if (last && now - last < SAMPLE_MS) return;
    settle(now);
    last = now;
    current = filesOnScreen();
  };

  for (const type of EVENTS)
    ctx.addEventListener(
      type === "selectionchange" ? document : window,
      type,
      () => {
        sample();
      },
      {
        passive: true,
        capture: true,
      },
    );
  ctx.addEventListener(document, "visibilitychange", () => {
    const now = Date.now();
    if (document.hidden) {
      settle(now);
      last = 0;
    } else sample(now);
  });

  return {
    /** The seconds spent on a file so far, which are then let go, so a file is learned from once. */
    take: (path: string): number => {
      const now = Date.now();
      if (!document.hidden && last) {
        settle(now);
        last = now;
      }
      const seconds = (spent.get(path) ?? 0) / 1000;
      spent.delete(path);
      return seconds;
    },
  };
};
