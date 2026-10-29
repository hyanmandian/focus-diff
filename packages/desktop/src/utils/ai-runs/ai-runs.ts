import type { AiReview } from "@/utils/ai/ai";

export type Reviewed = { head: string; review: AiReview };
type Run = { head: string; done: Promise<Reviewed> };

const running = new Map<string, Run>();

export const reviewRun = (pull: string): Run | null => running.get(pull) ?? null;

export function startReview(pull: string, head: string, work: () => Promise<AiReview>): Promise<Reviewed> {
  const now = running.get(pull);
  if (now?.head === head) return now.done;
  const done = work()
    .then((review) => {
      const reviewed = { head, review };
      try {
        localStorage.setItem(`ai-review:${pull}`, JSON.stringify(reviewed));
      } catch {}
      return reviewed;
    })
    .finally(() => {
      if (running.get(pull)?.done === done) running.delete(pull);
    });
  running.set(pull, { head, done });
  return done;
}

export function resetReviewRuns() {
  running.clear();
}
