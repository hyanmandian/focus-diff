import './stats.css';
import { i18n } from '#i18n';
import { clockIcon, doneIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatClock, formatDuration, formatNumber as format } from '@/utils/format';
import { LINES_PER_HOUR } from '@/utils/review-time';
import { createScoreboard } from '@/components/scoreboard/scoreboard';

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
  // The numbers are on scoreboards, for the eye; the text beside each is what screen readers hear.
  const files = createScoreboard('files-count');
  const additions = createScoreboard('additions');
  const deletions = createScoreboard('deletions');
  const time = createScoreboard('time');
  const readOut = () => h('span', { className: 'visually-hidden' });
  const filesText = readOut();
  const additionsText = readOut();
  const deletionsText = readOut();
  const timeWords = readOut();
  const done = h('span', { className: 'done' }, doneIcon(), i18n.t('timeDone'));
  const timeLabel = h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelTimeLabel')}` });
  const pendingText = readOut();
  const element = h(
    'span',
    { className: 'stats' },
    h(
      'span',
      { className: 'files' },
      files.element,
      filesText,
      h('span', { className: 'files-label', textContent: ` ${i18n.t('panelFilesLabel')}` }),
      pendingText,
    ),
    h('span', { className: 'lines' }, additions.element, additionsText, deletions.element, deletionsText),
    // The clock and the Done badge take turns in one place, as wide as the wider of them.
    h(
      'span',
      { className: 'time-wrap', 'data-tip': i18n.t('timeHint', [format(LINES_PER_HOUR)]) },
      h('span', { className: 'clock' }, clockIcon(), time.element),
      timeWords,
      timeLabel,
      done,
    ),
  );

  /**
   * `all` is the same with every file shown: the most each number can be in this pull request, so its cells, which
   * never change with the shown files.
   */
  const render = (totals: Totals, all: Totals = totals) => {
    const count = `${format(totals.visible)}/${format(totals.total)}`;
    files.set(count, `${format(all.total)}/${format(Math.max(all.total, totals.total))}`);
    filesText.textContent = count;
    const added = `+${format(totals.additions)}`;
    const removed = `−${format(totals.deletions)}`;
    additions.set(added, `+${format(all.additions)}`);
    deletions.set(removed, `−${format(all.deletions)}`);
    additionsText.textContent = ` ${added} ${i18n.t('panelLinesAdded')}`;
    deletionsText.textContent = ` ${removed} ${i18n.t('panelLinesRemoved')}`;
    time.set(totals.minutesLeft === 0 ? '–' : formatClock(totals.minutesLeft), formatClock(all.minutes));
    // Every shown file is marked as viewed: the time left gives way to a badge.
    element.toggleAttribute('data-done', isDone(totals));
    timeWords.textContent = totals.minutesLeft === 0 ? '' : ` ${formatDuration(totals.minutesLeft)}`;
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    // Files not loaded yet are told in the numbers' tooltip, and read out with them.
    const notLoaded = totals.pending > 0 ? i18n.t('panelNotLoaded', totals.pending, [format(totals.pending)]) : '';
    if (notLoaded) element.dataset.tip = notLoaded;
    else delete element.dataset.tip;
    pendingText.textContent = notLoaded ? ` ${notLoaded}` : '';
  };

  return { element, render, done };
};
