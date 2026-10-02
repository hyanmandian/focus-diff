import './stats.css';
import { i18n } from '#i18n';
import { doneIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatClock, formatDuration, formatNumber as format } from '@/utils/format';
import { LINES_PER_HOUR } from '@/utils/review-time';
import { createScoreboard } from '@/components/scoreboard/scoreboard';
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
  // The lines changed are on a scoreboard; the text beside each is what screen readers hear.
  const additions = createScoreboard('additions');
  const deletions = createScoreboard('deletions');
  const additionsText = h('span', { className: 'visually-hidden' });
  const deletionsText = h('span', { className: 'visually-hidden' });
  const time = counter('time', (seconds) => (seconds === 0 ? '–' : formatClock(seconds / 60)));
  // The clock is for the eye; screen readers hear the estimate in words.
  time.element.setAttribute('aria-hidden', 'true');
  const timeWords = h('span', { className: 'visually-hidden' });
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
    h('span', { className: 'lines' }, additions.element, additionsText, deletions.element, deletionsText),
    h(
      'span',
      { className: 'time-wrap', 'data-tip': i18n.t('timeHint', [format(LINES_PER_HOUR)]) },
      time.element,
      timeWords,
      timeLabel,
      done,
    ),
  );

  /**
   * The numbers are monospaced, and each keeps as many character cells as it has with every file shown, the most it can
   * have in this pull request. They count and change inside their cells, so nothing beside them moves.
   */
  let slotsFor = '';
  const sizeSlots = (all: Totals) => {
    const cells = (element: HTMLElement, widest: string) => (element.style.minWidth = `${widest.length}ch`);
    const key = `${all.total} ${all.additions} ${all.deletions} ${Math.round(all.minutes)}`;
    if (key === slotsFor) return;
    slotsFor = key;
    cells(visibleFiles.element, format(all.total));
    cells(time.element, formatClock(all.minutes));
  };

  /** `all` is the same with every file shown, which sizes the slots. */
  const render = (totals: Totals, all: Totals = totals) => {
    sizeSlots(all);
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    const added = `+${format(totals.additions)}`;
    const removed = `−${format(totals.deletions)}`;
    additions.set(added, `+${format(all.additions)}`.length);
    deletions.set(removed, `−${format(all.deletions)}`.length);
    additionsText.textContent = `${added} ${i18n.t('panelLinesAdded')}`;
    deletionsText.textContent = ` ${removed} ${i18n.t('panelLinesRemoved')}`;
    time.set(Math.round(totals.minutesLeft * 60));
    // Every shown file is marked as viewed: the time left gives way to a badge.
    element.toggleAttribute('data-done', isDone(totals));
    timeWords.textContent = totals.minutesLeft === 0 ? '' : formatDuration(totals.minutesLeft);
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    // Files not loaded yet are told in the numbers' tooltip, and read out with them.
    const notLoaded = totals.pending > 0 ? i18n.t('panelNotLoaded', totals.pending, [format(totals.pending)]) : '';
    if (notLoaded) element.dataset.tip = notLoaded;
    else delete element.dataset.tip;
    pendingText.textContent = notLoaded ? ` ${notLoaded}` : '';
  };

  return { element, render, done };
};
