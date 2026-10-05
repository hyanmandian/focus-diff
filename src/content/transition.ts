const PANEL = 'focus-diff-panel';
const FILE_CLASS = 'focus-diff-file';
const ACTIVE = 'data-focus-diff-filtering';
const STYLE_ID = 'focus-diff-transition';
/** Morphing more files than fit on a screen adds work without anything to see. */
const MAX_PIECES = 24;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MOVE_MS = 520;
const ENTER_MS = 460;
const EXIT_MS = 240;
const STAGGER_MS = 45;
const MAX_STAGGER = 8;

/** Bumped by each change, so the end of an earlier one doesn't undo a later one that's running. */
let generation = 0;

/**
 * Only while one of our filter changes runs. Each file on screen is its own layer: one that stays glides from where it
 * was to where it lands, while files that leave or arrive are animated below. The rest of the page switches at once,
 * since cross-fading a page that scrolls in the same change shows it twice; the panel sits it out, and the page stays
 * clickable throughout.
 */
const CSS = `
html[${ACTIVE}]::view-transition { pointer-events: none; }
html[${ACTIVE}]::view-transition-old(root) { display: none; }
html[${ACTIVE}]::view-transition-new(root) { animation: none; }
html[${ACTIVE}]::view-transition-group(*.${FILE_CLASS}) { animation-duration: ${MOVE_MS}ms; animation-timing-function: ${EASE_OUT}; }
html[${ACTIVE}]::view-transition-old(*.${FILE_CLASS}):only-child,
html[${ACTIVE}]::view-transition-new(*.${FILE_CLASS}):only-child { animation: none; }
html[${ACTIVE}]::view-transition-old(${PANEL}) { display: none; }
html[${ACTIVE}]::view-transition-group(${PANEL}),
html[${ACTIVE}]::view-transition-new(${PANEL}) { animation: none; }
html[${ACTIVE}]::view-transition-new(${PANEL}) { mix-blend-mode: normal; }
html[${ACTIVE}]::view-transition-group(${PANEL}) { z-index: 1; }
html[${ACTIVE}]::view-transition-image-pair(${PANEL}) { isolation: auto; }
`;

/** A file on screen, known by a key that stays the same if the site redraws its element. */
export interface Piece {
  key: string;
  element: HTMLElement;
}

/** Names the panel so a page transition leaves it out. */
export const keepOutOfTransitions = (host: HTMLElement): void => {
  host.style.setProperty('view-transition-name', PANEL);
};

const onScreen = (pieces: Piece[]) =>
  pieces
    .map((piece) => ({ ...piece, box: piece.element.getBoundingClientRect() }))
    .filter(({ box }) => box.height > 0 && box.bottom > 0 && box.top < innerHeight)
    .toSorted((a, b) => a.box.top - b.box.top)
    .slice(0, MAX_PIECES);

/**
 * Runs `update`, which swaps one filter's files for another's and may scroll, inside a view transition: files that stay
 * on screen glide into place, files that leave shrink away, and files that arrive rise in one after another. That's
 * where the browser has view transitions, the tab is on screen and the reader hasn't asked for less motion; otherwise
 * `update` just runs. `pieces` lists the files the site has drawn. Resolves once it's over.
 */
/** Whether a change can be animated: the browser has view transitions, the tab is on screen, and motion is welcome. */
export const canTransition = (): boolean =>
  typeof document.startViewTransition === 'function' &&
  document.visibilityState === 'visible' &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

export const withTransition = async (update: () => void, pieces: () => Piece[]): Promise<void> => {
  if (!canTransition()) return update();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }

  // A change that starts while another runs skips it; names carry the generation, so neither touches the other's.
  const mine = ++generation;
  const names = new Map<string, string>();
  const nameOf = (key: string) => names.get(key) ?? names.set(key, `focus-diff-${mine}-${names.size}`).get(key)!;
  const named = new Map<HTMLElement, string>();
  const name = (list: { key: string; element: HTMLElement }[]) =>
    list.map(({ key, element }) => {
      element.style.setProperty('view-transition-name', nameOf(key));
      element.style.setProperty('view-transition-class', FILE_CLASS);
      named.set(element, nameOf(key));
      return nameOf(key);
    });
  const unname = () => {
    for (const [element, value] of named) {
      if (element.style.getPropertyValue('view-transition-name') !== value) continue;
      element.style.removeProperty('view-transition-name');
      element.style.removeProperty('view-transition-class');
    }
    named.clear();
  };
  const animations: Animation[] = [];

  const root = document.documentElement;
  root.setAttribute(ACTIVE, '');
  const before = name(onScreen(pieces()));
  let after: string[] = [];
  const transition = document.startViewTransition(() => {
    // The old page is captured; the names move to wherever the files are now.
    unname();
    update();
    after = name(onScreen(pieces()));
  });
  try {
    await transition.ready;
    const leaving = before.filter((key) => !after.includes(key));
    const arriving = after.filter((key) => !before.includes(key));
    for (const key of leaving)
      animations.push(
        root.animate(
          { opacity: [1, 0], transform: ['none', 'scale(0.96)'], filter: ['none', 'blur(3px)'] },
          { duration: EXIT_MS, easing: 'ease-in', fill: 'both', pseudoElement: `::view-transition-old(${key})` },
        ),
      );
    arriving.forEach((key, index) =>
      animations.push(
        root.animate(
          { opacity: [0, 1], transform: ['translateY(28px) scale(0.98)', 'none'] },
          {
            duration: ENTER_MS,
            delay: EXIT_MS / 2 + Math.min(index, MAX_STAGGER) * STAGGER_MS,
            easing: EASE_OUT,
            fill: 'both',
            pseudoElement: `::view-transition-new(${key})`,
          },
        ),
      ),
    );
    await transition.finished;
  } catch {
    // Skipped, say by another transition starting; the update has still run.
  } finally {
    // Filled animations would otherwise linger on the page, holding these pseudo-elements.
    for (const animation of animations) animation.cancel();
    unname();
    if (mine === generation) root.removeAttribute(ACTIVE);
  }
};

/** Takes out what the transitions added to the site's page. */
export const removeTransitionStyle = (): void => {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(ACTIVE);
};
