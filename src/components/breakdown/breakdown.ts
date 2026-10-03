import './breakdown.css';
import { i18n } from '#i18n';
import { breakdownIcon, checkIcon, infoIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatDuration, formatNumber as format } from '@/utils/format/format';
import { LINES_PER_HOUR } from '@/utils/review-time/review-time';
import type { PanelOption } from '@/components/filters/filters';
import type { PanelContext } from '@/components/panel/panel';
import { centreOver, returnFocus } from '@/components/popover';
import type { Totals } from '@/components/stats/stats';

/** One filter's share of the pull request. */
export interface BreakdownRow extends PanelOption, Totals {}

interface BreakdownActions {
  onToggle: (id: string) => void;
  /** Called as it opens, so other popovers can close. */
  onOpen: () => void;
  /** Where focus goes when it closes and its toggle is gone. */
  fallback: HTMLElement;
}

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

/** How the pull request splits across the filters: files viewed, lines and time left for each. Rows toggle filters. */
export const createBreakdown = ({ host, focused }: PanelContext, { onToggle, onOpen, fallback }: BreakdownActions) => {
  const rows = h('div', { className: 'rows' });
  const popover = h(
    'div',
    { className: 'breakdown popover', id: 'focus-diff-breakdown', role: 'dialog', hidden: true, 'aria-label': i18n.t('panelBreakdown') },
    rows,
  );
  const toggle = h(
    'button',
    {
      type: 'button',
      className: 'icon-button breakdown-toggle',
      'data-tip': i18n.t('panelBreakdown'),
      'aria-label': i18n.t('panelBreakdown'),
      'aria-expanded': 'false',
      'aria-controls': 'focus-diff-breakdown',
    },
    breakdownIcon(),
  );

  /** The (i) beside "Time left": its tooltip explains the estimate, and is read out as its description. */
  const timeInfoButton = () => {
    const hint = i18n.t('timeHint', [format(LINES_PER_HOUR)]);
    return h(
      'button',
      {
        type: 'button',
        className: 'info',
        'aria-label': i18n.t('panelTimeInfo'),
        'aria-description': hint,
        'data-tip': hint,
        'data-tip-instant': '',
      },
      infoIcon(),
    );
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

  const row = (data: BreakdownRow, selected: boolean) => {
    // A complete row already reads as done through its green Viewed count, so its time stays empty.
    const time = data.minutesLeft === 0 ? '' : formatDuration(data.minutesLeft);
    const complete = data.visible > 0 && data.viewed === data.visible;
    // Files still loading might match, so an empty row only turns off once they're in.
    const disabled = data.visible === 0 && data.pending === 0 && !selected;
    return h(
      'button',
      {
        type: 'button',
        className: 'row',
        'data-row': data.id,
        'aria-pressed': String(selected),
        'aria-disabled': String(disabled),
        ...(disabled && {
          'data-tip': i18n.t('panelFilterEmpty', [data.name]),
          'aria-description': i18n.t('panelFilterEmpty', [data.name]),
        }),
        'aria-label': i18n.t('panelBreakdownRow', [
          data.name,
          i18n.t('fileCount', data.visible, [format(data.visible)]),
          format(data.viewed),
          format(data.additions),
          format(data.deletions),
          data.minutesLeft === 0 ? i18n.t('timeDone') : i18n.t('timeLeft', [time]),
        ]),
        onClick: () => disabled || onToggle(data.id),
      },
      h('span', { className: 'row-check' }, selected ? checkIcon() : null),
      h('span', { className: 'row-name', textContent: data.name }),
      h('span', { className: `row-viewed${complete ? ' complete' : ''}`, textContent: `${format(data.viewed)}/${format(data.visible)}` }),
      h(
        'span',
        { className: 'row-lines' },
        h('span', { className: 'additions', textContent: `+${format(data.additions)}` }),
        h('span', { className: 'deletions', textContent: `−${format(data.deletions)}` }),
        diffstat(data.additions, data.deletions),
      ),
      h('span', { className: 'row-time', textContent: time }),
    );
  };

  let source: { rows: () => BreakdownRow[]; selected: string[] } = { rows: () => [], selected: [] };
  let drawnKey = '';
  const draw = () => {
    if (popover.hidden) return;
    const list = source.rows();
    const { selected } = source;
    const key = JSON.stringify([list, selected]);
    if (key === drawnKey) return;
    drawnKey = key;
    const keepFocus = focused()?.dataset.row;
    const onInfo = focused()?.classList.contains('info');
    rows.replaceChildren(columns(), ...list.map((data) => row(data, selected.includes(data.id))));
    // Redrawn controls take focus back, so it doesn't fall to the page.
    if (keepFocus) rows.querySelector<HTMLElement>(`[data-row="${CSS.escape(keepFocus)}"]`)?.focus();
    else if (onInfo) rows.querySelector<HTMLElement>('.info')?.focus();
  };

  const reposition = () => centreOver(popover, toggle, host);

  const setOpen = (open: boolean) => {
    if (!open) returnFocus(popover, toggle, fallback, focused());
    popover.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      onOpen();
      draw();
      reposition();
    } else drawnKey = '';
  };
  const isOpen = () => !popover.hidden;
  toggle.addEventListener('click', () => setOpen(!isOpen()));

  /** Rows are only computed while it's open. */
  const render = (list: () => BreakdownRow[], selected: string[]) => {
    source = { rows: list, selected };
    draw();
  };

  return { toggle, popover, render, setOpen, reposition, isOpen };
};
