import './filters.css';
import { i18n } from '#i18n';
import { h } from '@/utils/dom';
import { formatNumber as format } from '@/utils/format';
import type { PanelContext } from '@/components/panel';

export interface PanelOption {
  id: string;
  name: string;
  /** Files this option shows. */
  count?: number;
}

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The filter chips: one roving tab stop, arrow keys between chips, and a highlight that slides to the pressed one.
 * `render` returns true when the list of filters itself changed.
 */
export const createFilters = ({ focused }: PanelContext, onToggle: (id: string) => void) => {
  const indicator = h('span', { className: 'indicator', 'aria-hidden': 'true' });
  const element = h('div', { className: 'filters', role: 'group', 'aria-label': i18n.t('panelShowFiles') }, indicator);
  const options = () => [...element.querySelectorAll<HTMLButtonElement>('.option')];

  const moveIndicator = () => {
    const pressed = element.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    element.classList.toggle('combined', pressed.length > 1);
    const target = pressed[0];
    if (pressed.length !== 1 || !target?.offsetWidth) return;
    const right = element.clientWidth - target.offsetLeft - target.offsetWidth;
    const bottom = element.clientHeight - target.offsetTop - target.offsetHeight;
    indicator.style.clipPath = `inset(${target.offsetTop}px ${right}px ${bottom}px ${target.offsetLeft}px round 8px)`;
    if (!indicator.classList.contains('ready')) requestAnimationFrame(() => indicator.classList.add('ready'));
  };

  element.addEventListener('keydown', (event) => {
    const list = options();
    const index = list.indexOf(focused() as HTMLButtonElement);
    if (index === -1) return;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : index + (ARROW_STEPS[event.key] ?? Number.NaN);
    if (Number.isNaN(target)) return;
    event.preventDefault();
    const next = list[(target + list.length) % list.length];
    if (!next) return;
    list.forEach((option) => (option.tabIndex = option === next ? 0 : -1));
    next.focus();
  });

  let optionsKey = '';
  let indicatorKey = '';
  const render = (list: PanelOption[], selected: string[]): boolean => {
    const key = JSON.stringify(list.map(({ id, name }) => [id, name]));
    const changed = key !== optionsKey;
    if (changed) {
      optionsKey = key;
      const keepFocus = element.contains(focused());
      options().forEach((option) => option.remove());
      element.append(
        ...list.map(({ id, name }) =>
          h(
            'button',
            { type: 'button', className: 'option', 'data-id': id, onClick: () => onToggle(id) },
            h('span', { className: 'option-name', textContent: name }),
            h('span', { className: 'option-count', 'aria-hidden': 'true' }),
            h('span', { className: 'visually-hidden option-count-label' }),
          ),
        ),
      );
      if (keepFocus) requestAnimationFrame(() => element.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
    }

    const current = focused()?.classList.contains('option') ? focused() : null;
    for (const option of options()) {
      const count = list.find((item) => item.id === option.dataset.id)?.count;
      const countElement = option.querySelector('.option-count');
      const countLabel = option.querySelector('.option-count-label');
      if (countElement && countLabel && count !== undefined) {
        const text = format(count);
        if (countElement.textContent !== text) countElement.textContent = text;
        countLabel.textContent = ` ${i18n.t('fileCount', count, [text])}`;
        option.classList.toggle('empty', count === 0);
      }
      const pressed = selected.includes(option.dataset.id ?? '');
      if (option.getAttribute('aria-pressed') !== String(pressed)) option.setAttribute('aria-pressed', String(pressed));
      option.tabIndex = (current ? option === current : option.dataset.id === selected[0]) ? 0 : -1;
    }
    // Measuring the chips forces a layout, so it only happens when the selection changes; a ResizeObserver covers the rest.
    const pressedKey = `${optionsKey} ${selected.join()}`;
    if (pressedKey !== indicatorKey) {
      indicatorKey = pressedKey;
      moveIndicator();
    }
    return changed;
  };

  return { element, render, moveIndicator };
};
