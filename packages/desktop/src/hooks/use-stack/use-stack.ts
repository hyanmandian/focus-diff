// The stack the pull request under review is in, for going through it in order: found once per
// pull request and head (stacks change by being pushed to). Yours too: going through your own
// stack in order is as handy.

import { useEffect, useState } from "react";

import type { Details } from "@/utils/details/details";
import { loadStack, type StackPull } from "@/utils/stack/stack";

export type Stack = { pulls: StackPull[]; at: number };

const found = new Map<string, Promise<StackPull[]>>();

/** The stack, bottom first, and where this pull request is in it; null when it's in none (or it's
 *  no longer open). */
export function useStack(details: Details | null): Stack | null {
  const [stack, setStack] = useState<{ key: string; stack: Stack } | null>(null);
  const wanted = details?.state === "OPEN" ? details : null;
  const key = wanted ? `${wanted.owner}/${wanted.repo}#${wanted.number}@${wanted.headRefOid}` : null;

  useEffect(() => {
    if (!wanted || !key) return () => {};
    let live = true;
    const self: StackPull = {
      id: wanted.id,
      number: wanted.number,
      title: wanted.title,
      author: wanted.author,
      isDraft: wanted.isDraft,
      decision: wanted.reviewDecision,
    };
    const asked =
      found.get(key) ??
      loadStack({
        owner: wanted.owner,
        repo: wanted.repo,
        headRefName: wanted.headRefName,
        baseRefName: wanted.baseRefName,
        self,
      });
    found.set(key, asked);
    const settle = async () => {
      try {
        const pulls = await asked;
        // Once per pull request and head: the details can be read again without anything new.
        if (live)
          setStack((s) =>
            s?.key === key ? s : { key, stack: { pulls, at: pulls.findIndex((p) => p.id === self.id) } },
          );
      } catch {
        // Not known: no stack to show. Asked again for the next head.
        found.delete(key);
      }
    };
    void settle();
    return () => {
      live = false;
    };
  }, [key, wanted]);

  // A stack of one isn't a stack; one for another pull request isn't this one's.
  return stack && stack.key === key && stack.stack.pulls.length > 1 ? stack.stack : null;
}
