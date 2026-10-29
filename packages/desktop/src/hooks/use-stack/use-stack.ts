import { useEffect, useState } from "react";

import type { Details } from "@/utils/details/details";
import { loadStack, type StackPull } from "@/utils/stack/stack";

export type Stack = { pulls: StackPull[]; at: number };

const found = new Map<string, Promise<StackPull[]>>();

export function useStack(details: Details | null): Stack | null {
  const [stack, setStack] = useState<{ key: string; stack: Stack } | null>(null);
  const wanted = details?.state === "OPEN" ? details : null;
  const key = wanted ? `${wanted.owner}/${wanted.repo}#${wanted.number}@${wanted.headRefOid}` : null;

  useEffect(() => {
    if (!wanted || !key) return;
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
        if (live)
          setStack((s) =>
            s?.key === key ? s : { key, stack: { pulls, at: pulls.findIndex((p) => p.id === self.id) } },
          );
      } catch {
        found.delete(key);
      }
    };
    void settle();
    return () => {
      live = false;
    };
  }, [key, wanted]);

  return stack && stack.key === key && stack.stack.pulls.length > 1 ? stack.stack : null;
}
