const PANEL = 'focus-diff-panel';
const ACTIVE = 'data-focus-diff-filtering';
const STYLE_ID = 'focus-diff-transition';
const DURATION_MS = 650;
/** Slow to start, so the circle is seen leaving the filter, then sweeping across. */
const EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
/** A pointer press older than this didn't start the change, like a keyboard shortcut after a click elsewhere. */
const CLICK_WINDOW_MS = 1000;

/**
 * Only while one of our filter changes runs: the browser's own cross-fade is off, so the animations below run alone;
 * the panel sits it out so its own animations carry on; and the page stays clickable throughout.
 */
const CSS = `
html[${ACTIVE}]::view-transition { pointer-events: none; }
html[${ACTIVE}]::view-transition-old(root),
html[${ACTIVE}]::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
html[${ACTIVE}]::view-transition-old(${PANEL}) { display: none; }
html[${ACTIVE}]::view-transition-group(${PANEL}),
html[${ACTIVE}]::view-transition-new(${PANEL}) { animation: none; }
`;

let lastPress = { x: 0, y: 0, at: -Infinity };
addEventListener('pointerdown', (event) => (lastPress = { x: event.clientX, y: event.clientY, at: performance.now() }), {
  capture: true,
  passive: true,
});

/** Names the panel so a page transition leaves it out. */
export const keepOutOfTransitions = (host: HTMLElement): void => {
  host.style.setProperty('view-transition-name', PANEL);
};

/** Where the change came from: the filter just clicked, or the middle of the panel for a keyboard shortcut. */
const originOf = (panel: Element | null) => {
  if (performance.now() - lastPress.at < CLICK_WINDOW_MS) return lastPress;
  const box = panel?.getBoundingClientRect();
  return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: innerWidth / 2, y: innerHeight };
};

/**
 * Runs `update`, which swaps one filter's files for another's, inside a view transition: the new page opens as a
 * circle from the filter that was picked, over the old one, which sinks back. That's where the browser has view
 * transitions, the tab is on screen and the reader hasn't asked for less motion; otherwise it just runs. Resolves
 * once it's over.
 */
export const withTransition = async (update: () => void): Promise<void> => {
  const animate =
    typeof document.startViewTransition === 'function' &&
    document.visibilityState === 'visible' &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate) return update();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.documentElement;
  const { x, y } = originOf(document.querySelector(PANEL));
  root.setAttribute(ACTIVE, '');
  const transition = document.startViewTransition(update);
  try {
    await transition.ready;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const timing = { duration: DURATION_MS, easing: EASING, fill: 'both' } as const;
    // The new page opens from the filter, lit up at first and settling as it spreads.
    root.animate(
      {
        clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        filter: ['brightness(1.25) saturate(1.2)', 'none'],
      },
      { ...timing, pseudoElement: '::view-transition-new(root)' },
    );
    // The old one sinks back under it.
    root.animate(
      { filter: ['none', 'brightness(0.7) blur(4px)'], transform: ['none', 'scale(0.98)'] },
      { ...timing, pseudoElement: '::view-transition-old(root)' },
    );
    await transition.finished;
  } catch {
    // Skipped, say by another transition starting; the update has still run.
  } finally {
    root.removeAttribute(ACTIVE);
  }
};

/** Takes out what the transitions added to GitHub's page. */
export const removeTransitionStyle = (): void => {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(ACTIVE);
};
