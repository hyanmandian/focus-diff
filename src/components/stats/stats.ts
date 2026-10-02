import './stats.css';
import { i18n } from '#i18n';
import { doneIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatDuration, formatNumber as format } from '@/utils/format';
import { LINES_PER_HOUR } from '@/utils/review-time';
import { counter } from './counter';

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
export const createStats = () => {
  const visibleFiles = counter('visible', format);
  const totalFiles = counter('total', format);
  const additions = counter('additions', (n) => `+${format(n)}`);
  const deletions = counter('deletions', (n) => `−${format(n)}`);
  const time = counter('time', (seconds) => (seconds === 0 ? '–' : formatDuration(seconds / 60)));
  const done = h('span', { className: 'done' }, doneIcon(), i18n.t('timeDone'));
  const timeLabel = h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelTimeLabel')}` });
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
   * Each number keeps a slot as wide as it is with every file shown, the most it can be in this pull request. Fewer
   * files shown leave a little room inside each slot rather than a gap at the end, and the bar keeps its width.
   */
  const ruler = h('span', { className: 'number ruler', 'aria-hidden': 'true' });
  element.append(ruler);
  const widthOf = (text: string) => {
    ruler.textContent = text;
    return Math.ceil(ruler.getBoundingClientRect().width);
  };
  let slotsFor = '';
  const sizeSlots = (all: Totals) => {
    const key = `${all.total} ${all.additions} ${all.deletions} ${Math.round(all.minutes)}`;
    // Measuring needs the stylesheet, which WXT injects a moment after the panel is created.
    if (key === slotsFor || getComputedStyle(ruler).position !== 'absolute') return;
    const files = widthOf(format(all.total));
    // Hidden, nothing can be measured yet.
    if (!files) return;
    slotsFor = key;
    visibleFiles.element.style.minWidth = `${files}px`;
    additions.element.style.minWidth = `${widthOf(`+${format(all.additions)}`)}px`;
    deletions.element.style.minWidth = `${widthOf(`−${format(all.deletions)}`)}px`;
    time.element.style.minWidth = `${widthOf(formatDuration(all.minutes))}px`;
    ruler.textContent = '';
  };

  /** `all` is the same with every file shown, which sizes the slots. */
  const render = (totals: Totals, all: Totals = totals) => {
    sizeSlots(all);
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    additions.set(totals.additions);
    deletions.set(totals.deletions);
    time.set(Math.round(totals.minutesLeft * 60));
    // Every shown file is marked as viewed: the time left gives way to a badge.
    element.toggleAttribute('data-done', isDone(totals));
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    // Files not loaded yet are told in the numbers' tooltip, and read out with them.
    const notLoaded = totals.pending > 0 ? i18n.t('panelNotLoaded', totals.pending, [format(totals.pending)]) : '';
    if (notLoaded) element.dataset.tip = notLoaded;
    else delete element.dataset.tip;
    pendingText.textContent = notLoaded ? ` ${notLoaded}` : '';
  };

  return { element, render, done };
};
