const EDGE = 18;

const pointAt = (popover: HTMLElement, trigger: HTMLElement): void => {
  const box = popover.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const x = Math.min(Math.max(target.left + target.width / 2 - box.left, EDGE), box.width - EDGE);
  popover.style.setProperty("--fd-arrow-x", `${Math.round(x)}px`);
};

const SCREEN_MARGIN = 16;

export const centreOver = (popover: HTMLElement, trigger: HTMLElement, offsetParent: HTMLElement): void => {
  if (popover.hidden || !trigger.offsetWidth) return;
  const parent = offsetParent.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const width = popover.getBoundingClientRect().width;
  const ideal = target.left + target.width / 2 - width / 2;
  const start = Math.max(parent.left, SCREEN_MARGIN);
  const screen = document.documentElement.clientWidth;
  const end = Math.min(parent.right, screen - SCREEN_MARGIN);
  const [min, max] = end - start >= width ? [start, end - width] : [SCREEN_MARGIN, screen - SCREEN_MARGIN - width];
  const left = Math.min(Math.max(ideal, min), max);
  popover.style.left = `${left - parent.left}px`;
  popover.style.right = "auto";
  pointAt(popover, trigger);
};

export const returnFocus = (
  popover: HTMLElement,
  toggle: HTMLElement,
  fallback: HTMLElement,
  focused: HTMLElement | null,
): void => {
  if (popover.contains(focused)) (toggle.hidden ? fallback : toggle).focus();
};
