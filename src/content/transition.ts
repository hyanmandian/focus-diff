const PANEL = 'focus-diff-panel';
const ACTIVE = 'data-focus-diff-filtering';
const STYLE_ID = 'focus-diff-transition';

/**
 * A short cross-fade on GitHub's page, only while a filter change is running, and only for ours. The panel sits it out
 * so its own animations carry on, and the page stays clickable throughout.
 */
const CSS = `
html[${ACTIVE}]::view-transition { pointer-events: none; }
html[${ACTIVE}]::view-transition-old(root),
html[${ACTIVE}]::view-transition-new(root) { animation-duration: 200ms; animation-timing-function: ease-out; }
html[${ACTIVE}]::view-transition-old(${PANEL}) { display: none; }
html[${ACTIVE}]::view-transition-group(${PANEL}),
html[${ACTIVE}]::view-transition-new(${PANEL}) { animation: none; }
`;

/** Names the panel so a page transition leaves it out. */
export const keepOutOfTransitions = (host: HTMLElement): void => {
  host.style.setProperty('view-transition-name', PANEL);
};

/**
 * Runs `update`, which swaps one filter's files for another's, inside a view transition where the browser has them,
 * the tab is on screen and the reader hasn't asked for less motion. Otherwise it just runs. Resolves once it's over.
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
  root.setAttribute(ACTIVE, '');
  const transition = document.startViewTransition(update);
  await transition.finished.catch(() => {});
  root.removeAttribute(ACTIVE);
};

/** Takes out what the transitions added to GitHub's page. */
export const removeTransitionStyle = (): void => {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(ACTIVE);
};
