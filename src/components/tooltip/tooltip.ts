import './tooltip.css';
import type { PanelContext } from '@/components/panel/panel';
import { h } from '@/utils/dom';

const DELAY_MS = 350;
const GAP = 8;
const SCREEN_MARGIN = 8;

/**
 * One tooltip for the whole panel: anything with a `data-tip` shows it above itself on hover, and on keyboard focus.
 * Controls already carry the same words as their accessible name or description, so screen readers skip it.
 */
export const createTooltip = ({ signal }: PanelContext, within: HTMLElement) => {
  const tip = h('div', { className: 'tip', 'aria-hidden': 'true', hidden: true });
  within.append(tip);
  let current: HTMLElement | null = null;
  let timer = 0;

  const place = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const screen = document.documentElement.clientWidth;
    const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, SCREEN_MARGIN), screen - SCREEN_MARGIN - width);
    tip.style.left = `${left}px`;
    tip.style.top = `${box.top - height - GAP}px`;
  };

  const show = (target: HTMLElement) => {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    tip.textContent = text;
    tip.hidden = false;
    place(target);
  };

  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.hidden = true;
  };

  const targetOf = (event: Event) => (event.target as Element | null)?.closest<HTMLElement>('[data-tip]') ?? null;

  within.addEventListener(
    'pointerover',
    (event) => {
      const target = targetOf(event);
      if (target === current) return;
      hide();
      if (!target) return;
      current = target;
      timer = window.setTimeout(() => show(target), DELAY_MS);
    },
    { signal },
  );
  within.addEventListener(
    'pointerout',
    (event) => {
      if (current && !current.contains(event.relatedTarget as Node | null)) hide();
    },
    { signal },
  );
  within.addEventListener(
    'focusin',
    (event) => {
      const target = targetOf(event);
      hide();
      if (target?.matches(':focus-visible')) {
        current = target;
        show(target);
      }
    },
    { signal },
  );
  within.addEventListener('focusout', hide, { signal });
  within.addEventListener('pointerdown', hide, { signal });
  document.addEventListener('keydown', (event) => event.key === 'Escape' && hide(), { signal });

  /** Keeps an open tooltip in step with its control, whose text or place may have changed. */
  const refresh = () => {
    if (current && !tip.hidden) show(current);
  };

  return { hide, refresh };
};
