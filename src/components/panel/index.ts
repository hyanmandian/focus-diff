import { i18n } from '#i18n';
import { counter } from '@/components/panel/counter';
import { centreOver, pointAt } from '@/components/panel/popover';
import { h, icon } from '@/utils/dom';
import { formatDuration, formatNumber as format } from '@/utils/format';
import { LINES_PER_HOUR } from '@/utils/review-time';

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

export interface PanelOption {
  id: string;
  name: string;
  /** Files this option shows. */
  count?: number;
}

export interface Navigation {
  /** Shown files not yet marked as viewed. */
  unviewed: number;
  /** Conversations in the shown files, and which one the reader last jumped to (0 before the first jump). */
  comments: { current: number; total: number };
}

export interface BreakdownRow extends PanelOption, Totals {}

export interface PanelActions {
  onToggle: (id: string) => void;
  onSettings: () => void;
  onNextUnviewed: () => void;
  onComment: (step: 1 | -1) => void;
}

export interface Panel {
  renderOptions: (options: PanelOption[], selected: string[]) => void;
  renderStats: (totals: Totals) => void;
  renderNavigation: (navigation: Navigation) => void;
  /** Rows are only computed while the breakdown is open. */
  renderBreakdown: (rows: () => BreakdownRow[], selected: string[]) => void;
  announce: (summary: Totals & { name: string }) => void;
  /** Reads out a short message, like where a jump landed. */
  announceText: (text: string) => void;
  setVisible: (visible: boolean) => void;
  reset: () => void;
}

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const settingsIcon = () =>
  icon([
    ['path', { d: 'M2 4h7M13 4h1M2 8h1M7 8h7M2 12h5M11 12h3' }],
    ['circle', { cx: '11', cy: '4', r: '2' }],
    ['circle', { cx: '5', cy: '8', r: '2' }],
    ['circle', { cx: '9', cy: '12', r: '2' }],
  ]);

const breakdownIcon = () => icon('M2 13.5h12M4 11V7M8 11V3M12 11V8');
const infoIcon = () =>
  icon(
    [
      ['circle', { cx: '8', cy: '8', r: '6.25' }],
      ['path', { d: 'M8 7.25v3.75M8 5v.25' }],
    ],
    14,
  );
const commentIcon = () => icon('M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z');
const chevron = (direction: 'up' | 'down') => icon(direction === 'up' ? 'M4.5 10 8 6.5 11.5 10' : 'M4.5 6 8 9.5 11.5 6');

interface PanelMount {
  root: ShadowRoot;
  container: HTMLElement;
  host: HTMLElement;
  signal: AbortSignal;
}

export const createPanel = (
  { root, container, host, signal }: PanelMount,
  { onToggle, onSettings, onNextUnviewed, onComment }: PanelActions,
): Panel => {
  const focused = () => root.activeElement as HTMLElement | null;

  const indicator = h('span', { className: 'indicator', 'aria-hidden': 'true' });
  const group = h('div', { className: 'filters', role: 'group', 'aria-label': i18n.t('panelShowFiles') }, indicator);
  const visibleFiles = counter('visible', format);
  const totalFiles = counter('total', format);
  const additions = counter('additions', (n) => `+${format(n)}`);
  const deletions = counter('deletions', (n) => `−${format(n)}`);
  const time = counter('time', (seconds) => (seconds === 0 ? i18n.t('timeDone') : formatDuration(seconds / 60)));
  const timeLabel = h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelTimeLabel')}` });
  const pending = h('span', { className: 'pending', 'aria-hidden': 'true' });
  const pendingText = h('span', { className: 'visually-hidden' });
  const stats = h(
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

  const nextUnviewed = h(
    'button',
    { type: 'button', className: 'next-unviewed', onClick: () => onNextUnviewed() },
    h('span', { className: 'next-unviewed-label', textContent: i18n.t('panelNextUnviewedLabel') }),
    h('span', { className: 'option-count', 'aria-hidden': 'true' }),
  );
  // One button walks forward through the conversations; going back only appears once there's somewhere to go back to.
  const commentPosition = h('span', { className: 'nav-count', 'aria-hidden': 'true' });
  const previousComment = h(
    'button',
    {
      type: 'button',
      className: 'comment-previous',
      hidden: true,
      'aria-label': i18n.t('panelPreviousComment'),
      title: i18n.t('panelPreviousComment'),
      onClick: () => onComment(-1),
    },
    chevron('up'),
  );
  const nextComment = h(
    'button',
    { type: 'button', className: 'comment-next', title: i18n.t('panelNextComment'), onClick: () => onComment(1) },
    h('span', { className: 'comments-icon', 'aria-hidden': 'true' }, commentIcon()),
    commentPosition,
  );
  const comments = h('span', { className: 'comments', role: 'group', 'aria-label': i18n.t('panelComments') }, previousComment, nextComment);
  const navigation = h('div', { className: 'navigation' }, nextUnviewed, comments);

  const breakdownRows = h('div', { className: 'rows' });
  const timeInfo = h('div', {
    className: 'tooltip',
    id: 'focus-diff-time-info',
    role: 'tooltip',
    hidden: true,
    textContent: i18n.t('timeHint', [LINES_PER_HOUR]),
  });
  const breakdown = h(
    'div',
    {
      className: 'breakdown popover',
      id: 'focus-diff-breakdown',
      role: 'dialog',
      hidden: true,
      'aria-label': i18n.t('panelBreakdown'),
    },
    breakdownRows,
    timeInfo,
  );
  const breakdownToggle = h(
    'button',
    {
      type: 'button',
      className: 'icon-button breakdown-toggle',
      title: i18n.t('panelBreakdown'),
      'aria-label': i18n.t('panelBreakdown'),
      'aria-expanded': 'false',
      'aria-controls': 'focus-diff-breakdown',
    },
    breakdownIcon(),
  );
  const settings = h('button', {
    type: 'button',
    className: 'settings icon-button',
    title: i18n.t('panelSettings'),
    onClick: () => onSettings(),
  });
  const status = h('span', { className: 'visually-hidden', role: 'status' });
  // The breakdown follows its toggle so Tab moves straight into it; it's positioned against the host.
  const panel = h('div', { className: 'panel' }, group, stats, breakdownToggle, breakdown, navigation, settings, status);
  container.append(panel);

  const options = () => [...group.querySelectorAll<HTMLButtonElement>('.option')];
  /** Every filter toggles; the controller keeps All exclusive and falls back to it when nothing is left. */
  const pick = (id: string) => onToggle(id);

  const moveIndicator = () => {
    const pressed = group.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    group.classList.toggle('combined', pressed.length > 1);
    const target = pressed[0];
    if (pressed.length !== 1 || !target?.offsetWidth) return;
    const right = group.clientWidth - target.offsetLeft - target.offsetWidth;
    const bottom = group.clientHeight - target.offsetTop - target.offsetHeight;
    indicator.style.clipPath = `inset(${target.offsetTop}px ${right}px ${bottom}px ${target.offsetLeft}px round 8px)`;
    if (!indicator.classList.contains('ready')) requestAnimationFrame(() => indicator.classList.add('ready'));
  };
  const resizeObserver = new ResizeObserver(() => {
    moveIndicator();
    centreOver(breakdown, breakdownToggle, host);
  });
  resizeObserver.observe(group);
  resizeObserver.observe(breakdown);
  signal.addEventListener('abort', () => resizeObserver.disconnect());

  group.addEventListener('keydown', (event) => {
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

  let breakdownSource: { rows: () => BreakdownRow[]; selected: string[] } = { rows: () => [], selected: [] };
  let drawnKey = '';
  const checkIcon = () => icon('M3.5 8.5 6.5 11.5 12.5 4.5');

  /** GitHub's five-square diffstat: the share of added and removed lines. */
  const diffstat = (additions: number, deletions: number) => {
    const total = additions + deletions;
    const added = total ? Math.round((additions / total) * 5) : 0;
    const removed = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0;
    return h(
      'span',
      { className: 'diffstat', 'aria-hidden': 'true' },
      ...Array.from({ length: 5 }, (_, index) => h('span', { className: index < added ? 'add' : index < added + removed ? 'del' : '' })),
    );
  };

  /** The (i) beside "Time left": explains the estimate on hover or focus. */
  const timeInfoButton = () => {
    const button = h(
      'button',
      { type: 'button', className: 'info', 'aria-label': i18n.t('panelTimeInfo'), 'aria-describedby': 'focus-diff-time-info' },
      infoIcon(),
    );
    // Sits above the icon, its arrow pointing down at it, like the breakdown does over its button.
    const open = () => {
      const box = button.getBoundingClientRect();
      const popover = breakdown.getBoundingClientRect();
      timeInfo.style.bottom = `${Math.round(popover.bottom - box.top + 10)}px`;
      timeInfo.hidden = false;
      pointAt(timeInfo, button);
    };
    const close = () => {
      timeInfo.hidden = true;
    };
    button.addEventListener('mouseenter', open);
    button.addEventListener('focus', open);
    button.addEventListener('mouseleave', close);
    button.addEventListener('blur', close);
    return button;
  };

  const columns = () =>
    h(
      'div',
      { className: 'columns' },
      h('span'),
      h('span', { textContent: i18n.t('panelColumnFilter') }),
      h('span', { textContent: i18n.t('panelColumnViewed') }),
      h('span', { textContent: i18n.t('panelColumnLines') }),
      h('span', { className: 'column-time' }, i18n.t('panelColumnTime'), timeInfoButton()),
    );

  const breakdownRow = (row: BreakdownRow, selected: boolean) => {
    // A complete row already reads as done through its green Viewed count, so its time stays empty.
    const time = row.minutesLeft === 0 ? '' : formatDuration(row.minutesLeft);
    const complete = row.visible > 0 && row.viewed === row.visible;
    return h(
      'button',
      {
        type: 'button',
        className: 'row',
        'data-row': row.id,
        'aria-pressed': String(selected),
        'aria-label': i18n.t('panelBreakdownRow', [
          row.name,
          i18n.t('fileCount', row.visible, [format(row.visible)]),
          format(row.viewed),
          format(row.additions),
          format(row.deletions),
          row.minutesLeft === 0 ? i18n.t('timeDone') : i18n.t('timeLeft', [time]),
        ]),
        onClick: () => pick(row.id),
      },
      h('span', { className: 'row-check' }, selected ? checkIcon() : null),
      h('span', { className: 'row-name', textContent: row.name }),
      h('span', { className: `row-viewed${complete ? ' complete' : ''}`, textContent: `${format(row.viewed)}/${format(row.visible)}` }),
      h(
        'span',
        { className: 'row-lines' },
        h('span', { className: 'additions', textContent: `+${format(row.additions)}` }),
        h('span', { className: 'deletions', textContent: `−${format(row.deletions)}` }),
        diffstat(row.additions, row.deletions),
      ),
      h('span', { className: 'row-time', textContent: time }),
    );
  };

  const drawBreakdown = () => {
    if (breakdown.hidden) return;
    const rows = breakdownSource.rows();
    const { selected } = breakdownSource;
    const key = JSON.stringify([rows, selected]);
    if (key === drawnKey) return;
    drawnKey = key;
    const keepFocus = focused()?.dataset.row;
    breakdownRows.replaceChildren(columns(), ...rows.map((row) => breakdownRow(row, selected.includes(row.id))));
    if (keepFocus) breakdownRows.querySelector<HTMLElement>(`[data-row="${CSS.escape(keepFocus)}"]`)?.focus();
  };

  const setBreakdownOpen = (open: boolean) => {
    breakdown.hidden = !open;
    breakdownToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      drawBreakdown();
      centreOver(breakdown, breakdownToggle, host);
    } else drawnKey = '';
  };
  breakdownToggle.addEventListener('click', () => setBreakdownOpen(breakdown.hidden));
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || breakdown.hidden) return;
      const focusInside = breakdown.contains(focused());
      setBreakdownOpen(false);
      if (focusInside) breakdownToggle.focus();
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!breakdown.hidden && !event.composedPath().includes(host)) setBreakdownOpen(false);
    },
    { signal },
  );

  let optionsKey = '';
  const renderOptions = (list: PanelOption[], selected: string[]) => {
    const key = JSON.stringify(list.map(({ id, name }) => [id, name]));
    if (key !== optionsKey) {
      optionsKey = key;
      const keepFocus = group.contains(focused());
      options().forEach((option) => option.remove());
      group.append(
        ...list.map(({ id, name }) =>
          h(
            'button',
            { type: 'button', className: 'option', 'data-id': id, onClick: () => pick(id) },
            h('span', { className: 'option-name', textContent: name }),
            h('span', { className: 'option-count', 'aria-hidden': 'true' }),
            h('span', { className: 'visually-hidden option-count-label' }),
          ),
        ),
      );
      if (keepFocus) requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());

      const configured = list.length > 1;
      settings.classList.toggle('labelled', !configured);
      breakdownToggle.hidden = !configured;
      if (configured) {
        settings.replaceChildren(settingsIcon());
        settings.setAttribute('aria-label', i18n.t('panelSettings'));
      } else {
        settings.textContent = i18n.t('panelSetUp');
        settings.removeAttribute('aria-label');
        setBreakdownOpen(false);
      }
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
    moveIndicator();
  };

  const renderBreakdown = (rows: () => BreakdownRow[], selected: string[]) => {
    breakdownSource = { rows, selected };
    drawBreakdown();
  };

  /** The stats block only grows: shorter numbers leave room at its end instead of shifting the buttons after it. */
  let reservedWidth = 0;
  const reserveStatsWidth = () => {
    // WXT injects the stylesheet asynchronously; before it lands, hidden labels are inline and inflate the width.
    if (host.style.display === 'none' || getComputedStyle(pendingText).position !== 'absolute') return;
    const width = Math.ceil(stats.getBoundingClientRect().width);
    if (width <= reservedWidth) return;
    reservedWidth = width;
    stats.style.minWidth = `${width}px`;
  };
  const resizeStats = new ResizeObserver(reserveStatsWidth);
  resizeStats.observe(stats);
  signal.addEventListener('abort', () => resizeStats.disconnect());

  const renderStats = (totals: Totals) => {
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    additions.set(totals.additions);
    deletions.set(totals.deletions);
    time.set(Math.round(totals.minutesLeft * 60));
    timeLabel.textContent = totals.minutesLeft === 0 ? '' : ` ${i18n.t('panelTimeLabel')}`;
    pending.classList.toggle('active', totals.pending > 0);
    pending.title = totals.pending > 0 ? i18n.t('panelNotLoaded', [format(totals.pending)]) : '';
    stats.title = pending.title;
    pendingText.textContent = pending.title ? ` ${pending.title}` : '';
  };

  const renderNavigation = ({ unviewed, comments: { current, total } }: Navigation) => {
    const unviewedLabel = unviewed ? i18n.t('panelNextUnviewed', [format(unviewed)]) : i18n.t('panelAllViewed');
    nextUnviewed.setAttribute('aria-label', unviewedLabel);
    nextUnviewed.title = unviewedLabel;
    nextUnviewed.disabled = unviewed === 0;
    const count = nextUnviewed.querySelector('.option-count');
    if (count) count.textContent = unviewed ? format(unviewed) : '';
    comments.hidden = total === 0;
    previousComment.hidden = current === 0;
    commentPosition.textContent = current ? `${format(current)}/${format(total)}` : format(total);
    const where = current
      ? i18n.t('panelCommentPosition', [format(current), format(total)])
      : i18n.t('panelCommentCount', total, [format(total)]);
    comments.setAttribute('aria-label', where);
    nextComment.setAttribute('aria-label', `${i18n.t('panelNextComment')}, ${where}`);
  };

  const announce = ({
    name,
    visible,
    total,
    additions: added,
    deletions: removed,
    pending: waiting,
    minutes,
  }: Totals & { name: string }) => {
    const parts = [
      i18n.t('panelAnnounce', [name, format(visible), format(total), format(added), format(removed)]),
      i18n.t('panelAnnounceTime', [formatDuration(minutes)]),
    ];
    if (waiting > 0) parts.push(i18n.t('panelAnnouncePartial', [format(waiting)]));
    status.textContent = parts.join(' ');
  };

  const setVisible = (visible: boolean) => {
    const display = visible ? '' : 'none';
    if (host.style.display === display) return;
    host.style.display = display;
    if (visible) requestAnimationFrame(moveIndicator);
    else setBreakdownOpen(false);
  };

  const reset = () => {
    optionsKey = '';
    drawnKey = '';
  };

  setVisible(false);
  const announceText = (text: string) => {
    status.textContent = text;
  };

  return { renderOptions, renderStats, renderNavigation, renderBreakdown, announce, announceText, setVisible, reset };
};
