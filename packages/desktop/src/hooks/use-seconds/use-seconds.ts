// Whole seconds since a moment, ticking once a second while there is one; 0 without.

import { useSyncExternalStore } from "react";

const NEVER = () => () => {};

export function useSeconds(since: number | null) {
  // The clock is the store: read it on each tick, and a render follows only when the whole
  // seconds change.
  return useSyncExternalStore(
    since === null
      ? NEVER
      : (changed) => {
          const tick = setInterval(changed, 1000);
          return () => {
            clearInterval(tick);
          };
        },
    () => (since === null ? 0 : Math.max(0, Math.floor((Date.now() - since) / 1000))),
  );
}
