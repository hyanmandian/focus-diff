import { creditFor, share, type OnScreen } from "@focus-diff/core/active-time";

import type { ContentScriptContext } from "#imports";

const SAMPLE_MS = 1000;
const EVENTS = ["scroll", "wheel", "keydown", "pointerdown", "pointermove", "selectionchange"] as const;

export const createActiveTime = (ctx: ContentScriptContext, filesOnScreen: () => OnScreen) => {
  const spent = new Map<string, number>();
  let pathname = location.pathname;
  let last = 0;
  let current: OnScreen = [];

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
