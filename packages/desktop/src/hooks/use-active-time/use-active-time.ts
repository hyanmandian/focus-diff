import { creditFor, share, type OnScreen } from "@focus-diff/core/active-time";
import { useCallback, useEffect, useEffectEvent, useRef } from "react";

const SAMPLE_MS = 1000;
const EVENTS = ["scroll", "wheel", "keydown", "pointerdown", "pointermove", "selectionchange"] as const;

export function useActiveTime(onScreen: () => OnScreen, on: boolean) {
  const spent = useRef(new Map<string, number>());
  const last = useRef(0);
  const current = useRef<OnScreen>([]);
  const read = useEffectEvent(() => onScreen());

  const settle = useCallback((now: number) => {
    if (!last.current) return;
    for (const [path, part] of share(creditFor(now - last.current), current.current))
      spent.current.set(path, (spent.current.get(path) ?? 0) + part);
  }, []);

  useEffect(() => {
    if (!on) return;
    const sample = () => {
      const now = Date.now();
      if (document.hidden || (last.current && now - last.current < SAMPLE_MS)) return;
      settle(now);
      last.current = now;
      current.current = read();
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
