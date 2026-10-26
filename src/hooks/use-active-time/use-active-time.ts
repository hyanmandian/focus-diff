// How long the reader actually spends on each file, to learn their pace from (Focus Diff's
// content/active-time). Only time they're there counts: the window showing and something happening,
// a scroll, a key, the mouse. A still moment counts too, up to a limit, since reading a hard line
// through takes stillness; past it they've likely stepped away. The time is shared by the files on
// screen, each by how much of it it takes.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { creditFor, share, type OnScreen } from "@/utils/estimate/estimate";

/** Activity is taken in at most this often; a moving mouse fires many times a second. */
const SAMPLE_MS = 1000;
const EVENTS = ["scroll", "wheel", "keydown", "pointerdown", "pointermove", "selectionchange"] as const;

/** `onScreen`: the files showing now; `on`: whether the files are showing at all (the Diff tab).
 *  Returns `take`: the seconds spent on a file so far, let go of once taken, so a file is learned
 *  from once. */
export function useActiveTime(onScreen: () => OnScreen, on: boolean) {
  const spent = useRef(new Map<string, number>());
  const last = useRef(0);
  const current = useRef<OnScreen>([]);
  const read = useRef(onScreen);
  useLayoutEffect(() => {
    read.current = onScreen;
  });

  /** Gives the time since the last moment of activity to the files on screen since then. */
  const settle = useCallback((now: number) => {
    if (!last.current) return;
    for (const [path, part] of share(creditFor(now - last.current), current.current))
      spent.current.set(path, (spent.current.get(path) ?? 0) + part);
  }, []);

  useEffect((): void | (() => void) => {
    if (!on) return;
    const sample = () => {
      const now = Date.now();
      if (document.hidden || (last.current && now - last.current < SAMPLE_MS)) return;
      settle(now);
      last.current = now;
      current.current = read.current();
    };
    const visibility = () => {
      if (!document.hidden) {
        sample();
        return;
      }
      settle(Date.now());
      last.current = 0;
    };
    for (const type of EVENTS)
      (type === "selectionchange" ? document : window).addEventListener(type, sample, { passive: true, capture: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      // Leaving the files: what's been spent so far is kept, the stillness after isn't counted.
      settle(Date.now());
      last.current = 0;
      for (const type of EVENTS)
        (type === "selectionchange" ? document : window).removeEventListener(type, sample, { capture: true });
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [on, settle]);

  return (path: string): number => {
    const now = Date.now();
    if (!document.hidden && last.current) {
      settle(now);
      last.current = now;
    }
    const seconds = (spent.current.get(path) ?? 0) / 1000;
    spent.current.delete(path);
    return seconds;
  };
}
