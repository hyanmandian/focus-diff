const EDGE = 18;

/** Points a popover's arrow at the centre of the button that opened it, kept clear of the rounded corners. */
export const pointAt = (popover: HTMLElement, trigger: HTMLElement): void => {
  if (popover.hidden || !trigger.offsetWidth) return;
  const box = popover.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const x = Math.min(Math.max(target.left + target.width / 2 - box.left, EDGE), box.width - EDGE);
  popover.style.setProperty('--fd-arrow-x', `${Math.round(x)}px`);
};
