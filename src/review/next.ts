// The pull request after this one in the queue it was opened from, in the panel's order, for going
// through a queue without going back to the panel. Read from the app's live state when the window
// comes forward (it's kept by Rust, watch.rs), and again when asked for.

import { useCallback, useEffect, useState } from "react";
import { nextAfter } from "@/lib/arrange";
import { bridge } from "@/lib/bridge";
import type { Item } from "@/lib/engine";
import { isUnread } from "@/lib/store";

type Live = { items: Record<string, Item[]>; seen: Record<string, true> };

async function find(queue: string, current: string) {
  const live = await bridge.snapshot<Live>();
  return nextAfter(live.items[queue] ?? [], current, (item) => isUnread(item, live.seen));
}

export function useNextInQueue(queue: string | null | undefined, current: string) {
  const [next, setNext] = useState<Item | null>(null);
  useEffect(() => {
    if (!queue) return;
    let live = true;
    const look = () => void find(queue, current).then((item) => live && setNext(item), () => {});
    look();
    window.addEventListener("focus", look);
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
  }, [queue, current]);

  /** On to it, in this window, counting as having looked at it as a click in the panel does. Asked
   *  again first: the queue may have moved on since the window came forward. */
  const go = useCallback(async () => {
    if (!queue) return;
    const item = (await find(queue, current).catch(() => null)) ?? next;
    if (!item) return setNext(null);
    void bridge.markSeen(item.queueId, item.pr.id);
    await bridge.switchReview(item.pr, item.viaTeams ?? [], item.queueId);
  }, [queue, current, next]);

  return { next, go };
}
