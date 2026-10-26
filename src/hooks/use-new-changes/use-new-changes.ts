// Whether the pull request moved on while it's being reviewed, as GitHub's "new changes" bar: a
// look every half minute while the window is up, and when it comes forward. Cheap: GitHub answers
// an unchanged pull request with a 304 (github.rs keeps the ETag), which doesn't count against
// the rate limit. New commits wait for the person (the diff doesn't change under them); new
// comments and the like come in on their own.

import { useEffect, useRef, useState } from "react";

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
  const known = useRef({ head, updatedAt });
  known.current = { head, updatedAt };
  const activity = useRef(onActivity);
  activity.current = onActivity;

  useEffect(() => {
    if (!head) return;
    // Up to date again (after Update, or another reload): nothing to say.
    setFound((f) => (f && f.head === head ? null : f));
    let live = true;
    let busy = false;
    const look = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const pr = await github<Rest>("GET", `/repos/${repo}/pulls/${number}`);
        if (!live) return;
        const now = known.current;
        if (now.head && pr.head.sha !== now.head) setFound({ head: pr.head.sha, at: Date.now() });
        else if (now.updatedAt && Date.parse(pr.updated_at) > Date.parse(now.updatedAt)) activity.current();
      } catch {
        // Offline or the like: the next look tries again.
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
