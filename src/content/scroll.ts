/**
 * Moving around a review page: scrolling something into place while the site is still drawing, and lighting it up once
 * it's there. How much of the screen's top the site covers comes from its provider.
 */

const RENDER_TIMEOUT_MS = 2000;
const FLASH_MS = 2000;
const HOLD_MS = 5000;
const SETTLED_MS = 600;
const DRIFT_PX = 24;
const READER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/** Resolves with what `find` finds once the site has drawn it, checking every frame, or `null` after `timeout`. */
export const waitFor = <T>(find: () => T | null, timeout = RENDER_TIMEOUT_MS): Promise<T | null> =>
  new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const found = find();
      if (found || performance.now() - started > timeout) return resolve(found);
      requestAnimationFrame(check);
    };
    check();
  });

const scrollBehavior = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'auto');

/** Lets go of the element held by the last jump, so two never pull the page different ways. */
let releaseHold = () => {};

/**
 * Scrolls so an element sits `offsetOf(its box)` below the top of the screen, and keeps it there while the site is still
 * drawing diffs on the way, which would otherwise push it off. A move of the target is followed in the same manner
 * the scroll started, so a smooth scroll stays smooth. It lets go once the page settles, or as soon as the reader
 * scrolls; going somewhere else lets go of the previous one.
 */
const scrollAndHold = (element: Element, offsetOf: (box: DOMRect) => number, behavior: ScrollBehavior): void => {
  // Hidden, say by a filter picked since the jump began: there's nowhere to go.
  if (!element.getClientRects().length) return;
  // Where the page has to be, within how far it can scroll.
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
    if (!held || !element.isConnected || now - started > HOLD_MS || now - settledSince > SETTLED_MS) return release();
    const next = targetOf();
    // Content drawn above moves the element; the site scrolling by itself moves the page, which only counts once the
    // page is still, so a smooth scroll on its way there isn't mistaken for it.
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

/** Brings an element to the top of the screen, right below the `covered` part. */
export const scrollToTop = (element: Element, covered: () => number, behavior: ScrollBehavior = scrollBehavior()): void =>
  scrollAndHold(element, covered, behavior);

/** Brings an element to the middle of the screen, clear of the `covered` part. */
export const scrollToCenter = (element: Element, covered: () => number): void =>
  scrollAndHold(element, (box) => Math.max(covered(), (innerHeight - box.height) / 2), scrollBehavior());

const FLASH_ID = 'focus-diff-flash';

const ring = (color: string, alpha: number, glow: number) =>
  `0 0 0 2px color-mix(in srgb, ${color} ${alpha}%, transparent), 0 0 0 ${glow}px color-mix(in srgb, ${color} ${alpha / 4}%, transparent)`;

/**
 * Lights a ring of `color` around an element after a jump so the eye finds it: it glows in, holds, and fades out. It's
 * an animation, so it leaves nothing behind on the site's markup.
 */
export const flash = (element: HTMLElement, color: string): void => {
  for (const animation of element.getAnimations()) if (animation.id === FLASH_ID) animation.cancel();
  // With reduced motion the ring doesn't grow; it shows, holds and fades.
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animation = element.animate(
    [
      { boxShadow: ring(color, 0, still ? 6 : 0), offset: 0 },
      { boxShadow: ring(color, 100, still ? 6 : 8), offset: 0.12 },
      { boxShadow: ring(color, 100, 6), offset: 0.7 },
      { boxShadow: ring(color, 0, still ? 6 : 0), offset: 1 },
    ],
    { duration: FLASH_MS, easing: 'ease-out' },
  );
  animation.id = FLASH_ID;
};
