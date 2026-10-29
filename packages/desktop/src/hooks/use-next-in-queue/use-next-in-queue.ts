import { useCallback, useEffect, useState } from "react";

import { nextAfter } from "@/utils/arrange/arrange";
import { bridge, type ReviewPull } from "@/utils/bridge/bridge";
import type { Item } from "@/utils/engine/engine";
import { isUnread } from "@/utils/store/store";

type Live = { items: Record<string, Item[]>; seen: Record<string, true> };

export type Visit = { pr: ReviewPull; teams: string[]; queue: string | null };

const BACK = "review-back";
export const DIRECTION = "review-direction";
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
  } catch {}
}

async function find(queue: string, current: string) {
  const live = await bridge.snapshot<Live>();
  return nextAfter(live.items[queue] ?? [], current, (item) => isUnread(item, live.seen));
}

export function useNextInQueue(queue: string | null | undefined, current: string, here: Visit | null) {
  const [next, setNext] = useState<Item | null>(null);
  const [previous] = useState(() => visits().at(-1) ?? null);
  useEffect(() => {
    if (!queue) return;
    let live = true;
    const ask = async () => {
      try {
        const item = await find(queue, current);
        if (live) setNext(item);
      } catch {}
    };
    const look = () => void ask();
    look();
    window.addEventListener("focus", look);
    return () => {
      live = false;
      window.removeEventListener("focus", look);
    };
  }, [queue, current]);

  const go = useCallback(
    async (done = false): Promise<boolean> => {
      if (!queue) return false;
      const item = (await find(queue, current).catch(() => null)) ?? next;
      if (done) await bridge.dismiss(queue, current);
      if (!item) {
        setNext(null);
        return false;
      }
      void bridge.markSeen(item.queueId, item.pr.id);
      if (here) keepVisits([...visits(), here]);
      sessionStorage.setItem(DIRECTION, "forward");
      await bridge.switchReview(item.pr, item.viaTeams ?? [], item.queueId);
      return true;
    },
    [queue, current, next, here],
  );

  const goTo = useCallback(
    async (to: Visit) => {
      if (here) keepVisits([...visits(), here]);
      sessionStorage.setItem(DIRECTION, "forward");
      await bridge.switchReview(to.pr, to.teams, to.queue);
    },
    [here],
  );

  const back = useCallback(async () => {
    const list = visits();
    const last = list.pop();
    if (!last) return;
    keepVisits(list);
    sessionStorage.setItem(DIRECTION, "back");
    await bridge.switchReview(last.pr, last.teams, last.queue);
  }, []);

  return { next, go, goTo, previous, back };
}
