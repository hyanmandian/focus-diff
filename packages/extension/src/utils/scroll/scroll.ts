const RENDER_TIMEOUT_MS = 2000;
const FLASH_MS = 2000;
const HOLD_MS = 5000;
const SETTLED_MS = 600;
const DRIFT_PX = 24;
const READER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

export const waitFor = <T>(find: () => T | null, timeout = RENDER_TIMEOUT_MS): Promise<T | null> =>
  new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const found = find();
      if (found || performance.now() - started > timeout) {
        resolve(found);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });

const scrollBehavior = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: no-preference)").matches ? "smooth" : "auto";

let releaseHold = () => {};

const scrollAndHold = (element: Element, offsetOf: (box: DOMRect) => number, behavior: ScrollBehavior): void => {
  if (element.getClientRects().length === 0) return;
  const targetOf = () => {
    const box = element.getBoundingClientRect();
    const top = box.top + scrollY - offsetOf(box);
    return Math.max(0, Math.min(top, document.documentElement.scrollHeight - innerHeight));
  };
  releaseHold();
  let target = targetOf();
  scrollTo({ top: target, behavior });

  const started = performance.now();
  let settledSince = started;
  let held = true;
  const release = () => {
    held = false;
    for (const type of READER_INPUT) removeEventListener(type, release, true);
  };
  releaseHold = release;
  for (const type of READER_INPUT) addEventListener(type, release, { capture: true, passive: true });
  let lastScrollY = scrollY;
  let stillFrames = 0;
  const hold = (now: number) => {
    if (!held || !element.isConnected || now - started > HOLD_MS || now - settledSince > SETTLED_MS) {
      release();
      return;
    }
    const next = targetOf();
    const moved = Math.abs(next - target) > DRIFT_PX;
    stillFrames = scrollY === lastScrollY ? stillFrames + 1 : 0;
    const strayed = stillFrames >= 3 && Math.abs(scrollY - next) > DRIFT_PX;
    if (moved || strayed) {
      target = next;
      settledSince = now;
      scrollTo({ top: target, behavior });
    }
    lastScrollY = scrollY;
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
};

export const scrollToTop = (
  element: Element,
  covered: () => number,
  behavior: ScrollBehavior = scrollBehavior(),
): void => {
  scrollAndHold(element, covered, behavior);
};

export const scrollToCenter = (element: Element, covered: () => number): void => {
  scrollAndHold(element, (box) => Math.max(covered(), (innerHeight - box.height) / 2), scrollBehavior());
};

const FLASH_ID = "focus-diff-flash";

const ring = (color: string, alpha: number, glow: number) =>
  `0 0 0 2px color-mix(in srgb, ${color} ${alpha}%, transparent), 0 0 0 ${glow}px color-mix(in srgb, ${color} ${alpha / 4}%, transparent)`;

export const flash = (element: HTMLElement, color: string): void => {
  for (const animation of element.getAnimations()) if (animation.id === FLASH_ID) animation.cancel();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animation = element.animate(
    [
      { boxShadow: ring(color, 0, still ? 6 : 0), offset: 0 },
      { boxShadow: ring(color, 100, still ? 6 : 8), offset: 0.12 },
      { boxShadow: ring(color, 100, 6), offset: 0.7 },
      { boxShadow: ring(color, 0, still ? 6 : 0), offset: 1 },
    ],
    { duration: FLASH_MS, easing: "ease-out" },
  );
  animation.id = FLASH_ID;
};
