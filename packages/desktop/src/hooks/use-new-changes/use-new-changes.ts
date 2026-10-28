import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { github } from "@/utils/bridge/bridge";

type Rest = { head: { sha: string }; updated_at: string; user: { login: string } | null };

export type NewChanges = { head: string; at: number };

const EVERY = 30_000;

export function useNewChanges(
  repo: string,
  number: number,
  head: string | undefined,
  updatedAt: string | undefined,
  onActivity: () => void,
) {
  const [found, setFound] = useState<NewChanges | null>(null);
  const [shown, setShown] = useState(head);
  if (shown !== head) {
    setShown(head);
    if (found && found.head === head) setFound(null);
  }
  const known = useRef(updatedAt);
  const activity = useRef(onActivity);
  useLayoutEffect(() => {
    known.current = updatedAt;
    activity.current = onActivity;
  });

  useEffect(() => {
    if (!head) return;
    let live = true;
    let busy = false;
    const look = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const pr = await github<Rest>("GET", `/repos/${repo}/pulls/${number}`);
        if (!live) return;
        const since = known.current;
        if (pr.head.sha !== head) setFound({ head: pr.head.sha, at: Date.now() });
        else if (since && Date.parse(pr.updated_at) > Date.parse(since)) activity.current();
      } catch {
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void look(), EVERY);
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [repo, number, head]);

  return found;
}
