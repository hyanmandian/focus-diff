import './stats.css';
import { i18n } from '#i18n';
import { doneIcon } from '@/components/icons';
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

/** Every shown file is marked as viewed, and they're all loaded. */
export const isDone = (totals: Totals): boolean => totals.visible > 0 && totals.minutesLeft === 0 && totals.pending === 0;

/** Shown files out of all, lines added and removed, and the time left to review them. */
export const createStats = ({ host, signal }: PanelContext) => {
  const visibleFiles = counter('visible', format);
  const totalFiles = counter('total', format);
  const additions = counter('additions', (n) => `+${format(n)}`);
  const deletions = counter('deletions', (n) => `−${format(n)}`);
  const time = counter('time', (seconds) => (seconds === 0 ? '–' : formatDuration(seconds / 60)));
  const done = h('span', { className: 'done' }, doneIcon(), i18n.t('timeDone'));
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
    h('span', { className: 'time-wrap', 'data-tip': i18n.t('timeHint', [format(LINES_PER_HOUR)]) }, time.element, timeLabel, done),
  );

  /**
   * The panel sits in the corner, so a narrower block would slide the filter chips under the pointer. Shorter numbers
   * leave room at its end instead; the room is kept per pull request.
   */
  let reservedWidth = 0;
  let reservedFor = -1;
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
    // Another pull request starts from its own numbers.
    if (totals.total !== reservedFor) {
      reservedFor = totals.total;
      reservedWidth = 0;
      element.style.minWidth = '';
    }
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    additions.set(totals.additions);
    deletions.set(totals.deletions);
    time.set(Math.round(totals.minutesLeft * 60));
    // Every shown file is marked as viewed: the time left gives way to a badge.
    element.toggleAttribute('data-done', isDone(totals));
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    pending.classList.toggle('active', totals.pending > 0);
    // The dot's meaning is in the panel's tooltip, and read out with the numbers.
    const notLoaded = totals.pending > 0 ? i18n.t('panelNotLoaded', totals.pending, [format(totals.pending)]) : '';
    if (notLoaded) element.dataset.tip = notLoaded;
    else delete element.dataset.tip;
    pendingText.textContent = notLoaded ? ` ${notLoaded}` : '';
  };

  return { element, render, done };
};
