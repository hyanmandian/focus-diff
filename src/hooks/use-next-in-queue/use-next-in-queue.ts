// The pull request after this one in the queue it was opened from, in the panel's order, for going
// through a queue without going back to the panel. Read from the app's live state when the window
// comes forward (it's kept by Rust, watch.rs), and again when asked for. And back: the ones this
// window showed before, as a browser's history (kept for the window, in its session storage).

import { useCallback, useEffect, useState } from "react";

import { nextAfter } from "@/utils/arrange/arrange";
import { bridge, type ReviewPull } from "@/utils/bridge/bridge";
import type { Item } from "@/utils/engine/engine";
import { isUnread } from "@/utils/store/store";

type Live = { items: Record<string, Item[]>; seen: Record<string, true> };

/** A pull request this window showed, enough to show it again. */
export type Visit = { pr: ReviewPull; teams: string[]; queue: string | null };

const BACK = "review-back";
/** Which way the window is going, for the page to slide that way (entries/review.tsx). */
export const DIRECTION = "review-direction";
/** Written by this window (keepVisits), so a list is taken as one of visits. */
const isVisits = (value: unknown): value is Visit[] => Array.isArray(value);
function visits(): Visit[] {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(BACK) ?? "[]");
    return isVisits(list) ? list : [];
  } catch {
    return [];
  }
}
function keepVisits(list: Visit[]) {
  try {
    sessionStorage.setItem(BACK, JSON.stringify(list.slice(-50)));
  } catch {
    // Back only as far as this showing, then.
  }
}

async function find(queue: string, current: string) {
  const live = await bridge.snapshot<Live>();
  return nextAfter(live.items[queue] ?? [], current, (item) => isUnread(item, live.seen));
}

export function useNextInQueue(queue: string | null | undefined, current: string, here: Visit | null) {
  const [next, setNext] = useState<Item | null>(null);
  const [previous] = useState(() => visits().at(-1) ?? null);
  useEffect((): void | (() => void) => {
    if (!queue) return;
    let live = true;
    const ask = async () => {
      try {
        const item = await find(queue, current);
        if (live) setNext(item);
      } catch {
        // What it was stays; the next look asks again.
      }
    };
    const look = () => void ask();
    look();
    window.addEventListener("focus", look);
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
  }, [queue, current]);

  /** On to it, in this window, counting as having looked at it as a click in the panel does. Asked
   *  again first: the queue may have moved on since the window came forward. */
  const go = useCallback(async (): Promise<boolean> => {
    if (!queue) return false;
    const item = (await find(queue, current).catch(() => null)) ?? next;
    // The queue's done: false, for the window to say so.
    if (!item) {
      setNext(null);
      return false;
    }
    void bridge.markSeen(item.queueId, item.pr.id);
    if (here) keepVisits([...visits(), here]);
    sessionStorage.setItem(DIRECTION, "forward");
    await bridge.switchReview(item.pr, item.viaTeams ?? [], item.queueId);
    return true;
  }, [queue, current, next, here]);

  /** Back to the one shown before this, in this window. */
  const back = useCallback(async () => {
    const list = visits();
    const last = list.pop();
    if (!last) return;
    keepVisits(list);
    sessionStorage.setItem(DIRECTION, "back");
    await bridge.switchReview(last.pr, last.teams, last.queue);
  }, []);

  return { next, go, previous, back };
}
