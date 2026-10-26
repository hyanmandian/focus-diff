// Tests only: what several tests need to hold something back.

/** A promise that settles when the test says, for what's shown while something's under way. */
export function later() {
  const settle: Array<() => void> = [];
  const promise = new Promise<void>((resolve) => {
    settle.push(resolve);
  });
  return {
    promise,
    settle: () => {
      settle[0]!();
    },
  };
}
