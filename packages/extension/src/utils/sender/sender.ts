// What's on its way to GitHub (pending review comments, viewed marks), sent one at a time until nothing's left, as
// the desktop's drafts.rs and outbox.rs send theirs: at once when something new comes, and after a failure again in
// 1s, 2s, 4s… up to 30s, unless something new comes first.

const LONGEST_WAIT = 30_000;

/** How long to wait after this many failures in a row. */
export const backoff = (failures: number): number => Math.min(1000 * 2 ** (Math.min(failures, 6) - 1), LONGEST_WAIT);

/** How one send went: it went (or was settled), it failed and calls for a wait, or there was nothing to send. */
export type Outcome = "sent" | "failed" | "idle";

/** Waits `ms`, or until `wake` is called with the resolver it was handed. */
const pause = (ms: number, hold: (wake: () => void) => void) =>
  new Promise<void>((resolve) => {
    hold(resolve);
    setTimeout(resolve, ms);
  });

/** Runs `step` while it has something to send. `wake` says there's something new: it's sent now. */
export const createSender = (step: () => Promise<Outcome>) => {
  let running = false;
  let woken = false;
  let wakeUp: (() => void) | null = null;
  let failures = 0;
  const hold = (wake: () => void) => {
    wakeUp = wake;
  };

  const run = async () => {
    running = true;
    for (;;) {
      woken = false;
      // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time, in order
      const outcome = await step().catch((): Outcome => "failed");
      if (outcome === "idle") break;
      failures = outcome === "failed" ? failures + 1 : 0;
      if (failures > 0 && !woken) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- waiting between tries is the point
        await pause(backoff(failures), hold);
        wakeUp = null;
      }
    }
    running = false;
  };

  return {
    wake: () => {
      woken = true;
      const waiting = wakeUp;
      wakeUp = null;
      waiting?.();
      if (!running) void run();
    },
  };
};
