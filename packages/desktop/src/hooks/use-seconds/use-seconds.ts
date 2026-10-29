import { useSyncExternalStore } from "react";

const NEVER = () => () => {};

export function useSeconds(since: number | null) {
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
