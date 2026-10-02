const EDGE = 18;

/** Points a popover's arrow at the centre of the button that opened it, kept clear of the rounded corners. */
export const pointAt = (popover: HTMLElement, trigger: HTMLElement): void => {
  if (popover.hidden || !trigger.offsetWidth) return;
  const box = popover.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const x = Math.min(Math.max(target.left + target.width / 2 - box.left, EDGE), box.width - EDGE);
  popover.style.setProperty('--fd-arrow-x', `${Math.round(x)}px`);
};

const SCREEN_MARGIN = 16;

/**
 * Centres an absolutely positioned popover over the button that opened it, kept within `offsetParent` (the element it's
 * positioned against) and on screen, then points its arrow at the button.
 */
export const centreOver = (popover: HTMLElement, trigger: HTMLElement, offsetParent: HTMLElement): void => {
  if (popover.hidden || !trigger.offsetWidth) return;
  const parent = offsetParent.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const width = popover.getBoundingClientRect().width;
  const ideal = target.left + target.width / 2 - width / 2;
  const start = Math.max(parent.left, SCREEN_MARGIN);
  // The page's width without its scrollbar, which the panel's fixed position also leaves out.
  const screen = document.documentElement.clientWidth;
  const end = Math.min(parent.right, screen - SCREEN_MARGIN);
  // A popover wider than the panel is only kept on screen.
  const [min, max] = end - start >= width ? [start, end - width] : [SCREEN_MARGIN, screen - SCREEN_MARGIN - width];
  const left = Math.min(Math.max(ideal, min), max);
  popover.style.left = `${Math.round(left - parent.left)}px`;
  popover.style.right = 'auto';
  pointAt(popover, trigger);
};

/** Focus inside a closing popover goes back to its toggle, or to `fallback` when the toggle is gone too. */
export const returnFocus = (popover: HTMLElement, toggle: HTMLElement, fallback: HTMLElement, focused: HTMLElement | null): void => {
  if (popover.contains(focused)) (toggle.hidden ? fallback : toggle).focus();
};
