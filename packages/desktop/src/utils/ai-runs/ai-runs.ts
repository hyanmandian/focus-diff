import { newRun, type AiReview } from "@/utils/ai/ai";
import { bridge } from "@/utils/bridge/bridge";

export type Reviewed = { head: string; review: AiReview };
type Run = { head: string; id: string; done: Promise<Reviewed> };

export class ReviewStopped extends Error {}

const running = new Map<string, Run>();
const stopped = new Set<string>();

export const reviewRun = (pull: string): Run | null => running.get(pull) ?? null;

export function startReview(pull: string, head: string, work: (run: string) => Promise<AiReview>): Promise<Reviewed> {
  const now = running.get(pull);
  if (now?.head === head) return now.done;
  const id = newRun();
  const done = work(id)
    .then((review) => {
      const reviewed = { head, review };
      try {
        localStorage.setItem(`ai-review:${pull}`, JSON.stringify(reviewed));
      } catch {}
      return reviewed;
    })
    .catch((error: unknown) => {
      throw stopped.has(id) ? new ReviewStopped() : error;
    })
    .finally(() => {
      stopped.delete(id);
      if (running.get(pull)?.done === done) running.delete(pull);
    });
  running.set(pull, { head, id, done });
  return done;
}

export function stopReview(pull: string) {
  const run = running.get(pull);
  if (!run) return;
  stopped.add(run.id);
  void bridge.aiCancel(run.id).catch(() => {});
}

export function resetReviewRuns() {
  running.clear();
  stopped.clear();
}
