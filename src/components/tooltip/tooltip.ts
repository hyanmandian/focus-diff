import './tooltip.css';
import type { PanelContext } from '@/components/panel/panel';
import { h } from '@/utils/dom';

const DELAY_MS = 350;
/** Long enough to move the pointer onto the tooltip, which keeps it open. */
const LINGER_MS = 120;
const GAP = 10;
const SCREEN_MARGIN = 8;
/** Keeps the arrow clear of the tooltip's rounded corners. */
const ARROW_EDGE = 14;

/**
 * One tooltip for the whole panel: anything with a `data-tip` shows it above itself on hover, and on keyboard focus;
 * `data-tip-instant` skips the delay, for an (i) whose only job is the tooltip. The pointer can move onto the tooltip
 * to read it. Controls carry the same words as their accessible name or description, so screen readers skip it.
 */
export const createTooltip = ({ signal }: PanelContext, within: HTMLElement) => {
  const tip = h('div', { className: 'tip', 'aria-hidden': 'true', hidden: true });
  within.append(tip);
  let current: HTMLElement | null = null;
  let showing = 0;
  let hiding = 0;

  const place = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const screen = document.documentElement.clientWidth;
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, SCREEN_MARGIN), screen - SCREEN_MARGIN - width);
    tip.style.left = `${left}px`;
    tip.style.top = `${box.top - height - GAP}px`;
    // The arrow points at the control's centre, even when the tooltip is held on screen.
    const arrow = Math.min(Math.max(box.left + box.width / 2 - left, ARROW_EDGE), width - ARROW_EDGE);
    tip.style.setProperty('--fd-tip-arrow-x', `${arrow}px`);
  };

  const show = (target: HTMLElement) => {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    tip.textContent = text;
    tip.hidden = false;
    place(target);
  };

  const hide = () => {
    clearTimeout(showing);
    clearTimeout(hiding);
    current = null;
    tip.hidden = true;
  };

  const open = (target: HTMLElement, delay: number) => {
    hide();
    current = target;
    if (delay) showing = window.setTimeout(() => show(target), delay);
    else show(target);
  };

  const targetOf = (event: Event) => (event.target as Element | null)?.closest<HTMLElement>('[data-tip]') ?? null;

  within.addEventListener(
    'pointerover',
    (event) => {
      clearTimeout(hiding);
      if (tip.contains(event.target as Node)) return;
      const target = targetOf(event);
      if (target === current) return;
      if (!target) return hide();
      open(target, 'tipInstant' in target.dataset ? 0 : DELAY_MS);
    },
    { signal },
  );
  within.addEventListener(
    'pointerout',
    (event) => {
      const next = event.relatedTarget as Node | null;
      if (!current || current.contains(next) || tip.contains(next)) return;
      clearTimeout(showing);
      hiding = window.setTimeout(hide, LINGER_MS);
    },
    { signal },
  );
  within.addEventListener(
    'focusin',
    (event) => {
      const target = targetOf(event);
      if (target?.matches(':focus-visible')) open(target, 0);
      else hide();
    },
    { signal },
  );
  within.addEventListener('focusout', hide, { signal });
  within.addEventListener(
    'pointerdown',
    (event) => {
      if (!tip.contains(event.target as Node)) hide();
    },
    { signal },
  );

  return {
    hide,
    isVisible: () => !tip.hidden,
    /** Keeps an open tooltip in step with its control, whose text or place may have changed. */
    refresh: () => {
      if (current && !tip.hidden) show(current);
    },
  };
};
