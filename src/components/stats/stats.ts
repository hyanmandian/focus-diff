import './stats.css';
import { i18n } from '#i18n';
import { h } from '@/utils/dom';
import { formatDuration, formatNumber as format } from '@/utils/format';
import { LINES_PER_HOUR } from '@/utils/review-time';
import { counter } from './counter';
import type { PanelContext } from '@/components/panel/panel';

export interface Totals {
  visible: number;
  total: number;
  additions: number;
  deletions: number;
  pending: number;
  /** Estimated review time, see utils/review-time.ts. */
  minutes: number;
  /** Files marked as viewed on GitHub, and the estimate for the rest. */
  viewed: number;
  minutesLeft: number;
}

/** Shown files out of all, lines added and removed, and the time left to review them. */
export const createStats = ({ host, signal }: PanelContext) => {
  const visibleFiles = counter('visible', format);
  const totalFiles = counter('total', format);
  const additions = counter('additions', (n) => `+${format(n)}`);
  const deletions = counter('deletions', (n) => `−${format(n)}`);
  const time = counter('time', (seconds) => (seconds === 0 ? i18n.t('timeDone') : formatDuration(seconds / 60)));
  const timeLabel = h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelTimeLabel')}` });
  const pending = h('span', { className: 'pending', 'aria-hidden': 'true' });
  const pendingText = h('span', { className: 'visually-hidden' });
  const element = h(
    'span',
    { className: 'stats' },
    h(
      'span',
      { className: 'files' },
      visibleFiles.element,
      h('span', { className: 'number', textContent: '/' }),
      totalFiles.element,
      h('span', { className: 'files-label', textContent: ` ${i18n.t('panelFilesLabel')}` }),
      pending,
      pendingText,
    ),
    h(
      'span',
      { className: 'lines' },
      additions.element,
      h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelLinesAdded')}` }),
      deletions.element,
      h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelLinesRemoved')}` }),
    ),
    h('span', { className: 'time-wrap', title: i18n.t('timeHint', [LINES_PER_HOUR]) }, time.element, timeLabel),
  );

  /** The block only grows: shorter numbers leave room at its end instead of shifting the buttons after it. */
  let reservedWidth = 0;
  const reserveWidth = () => {
    // WXT injects the stylesheet asynchronously; before it lands, hidden labels are inline and inflate the width.
    if (host.style.display === 'none' || getComputedStyle(pendingText).position !== 'absolute') return;
    const width = Math.ceil(element.getBoundingClientRect().width);
    if (width <= reservedWidth) return;
    reservedWidth = width;
    element.style.minWidth = `${width}px`;
  };
  const resizeObserver = new ResizeObserver(reserveWidth);
  resizeObserver.observe(element);
  signal.addEventListener('abort', () => resizeObserver.disconnect());

  const render = (totals: Totals) => {
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    additions.set(totals.additions);
    deletions.set(totals.deletions);
    time.set(Math.round(totals.minutesLeft * 60));
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    pending.classList.toggle('active', totals.pending > 0);
    pending.title = totals.pending > 0 ? i18n.t('panelNotLoaded', totals.pending, [format(totals.pending)]) : '';
    element.title = pending.title;
    pendingText.textContent = pending.title ? ` ${pending.title}` : '';
  };

  return { element, render };
};
