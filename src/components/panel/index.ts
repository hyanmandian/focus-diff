import { i18n } from '#i18n';
import { counter } from '@/components/panel/counter';
import { pointAt } from '@/components/panel/popover';
import { h, icon } from '@/utils/dom';
import { formatDuration, formatNumber as format, LINES_PER_HOUR } from '@/utils/format';

export interface Totals {
  visible: number;
  total: number;
  additions: number;
  deletions: number;
  pending: number;
}

export interface PanelOption {
  id: string;
  name: string;
}

export interface BreakdownRow extends PanelOption, Totals {}

export interface PanelActions {
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onSettings: () => void;
}

export interface Panel {
  renderOptions: (options: PanelOption[], selected: string[]) => void;
  renderStats: (totals: Totals) => void;
  /** Rows are only computed while the breakdown is open. */
  renderBreakdown: (rows: () => BreakdownRow[], selected: string[]) => void;
  announce: (summary: Totals & { name: string }) => void;
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

interface PanelMount {
  root: ShadowRoot;
  container: HTMLElement;
  host: HTMLElement;
  signal: AbortSignal;
}

export const createPanel = ({ root, container, host, signal }: PanelMount, { onSelect, onToggle, onSettings }: PanelActions): Panel => {
  const focused = () => root.activeElement as HTMLElement | null;

  const indicator = h('span', { className: 'indicator', 'aria-hidden': 'true' });
  const group = h('div', { className: 'filters', role: 'group', 'aria-label': i18n.t('panelShowFiles') }, indicator);
  const visibleFiles = counter('visible', format);
  const totalFiles = counter('total', format);
  const additions = counter('additions', (n) => `+${format(n)}`);
  const deletions = counter('deletions', (n) => `−${format(n)}`);
  const time = counter('time', formatDuration);
  const pending = h('span', { className: 'pending', 'aria-hidden': 'true' });
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
    ),
    additions.element,
    h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelLinesAdded')}` }),
    deletions.element,
    h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelLinesRemoved')}` }),
    h(
      'span',
      { className: 'time-wrap', title: i18n.t('timeHint', [LINES_PER_HOUR]) },
      time.element,
      h('span', { className: 'visually-hidden', textContent: ` ${i18n.t('panelTimeLabel')}` }),
    ),
    pending,
  );

  const breakdownRows = h('div', { className: 'rows' });
  const breakdown = h(
    'div',
    { className: 'breakdown popover', id: 'focus-diff-breakdown', hidden: true, 'aria-labelledby': 'focus-diff-breakdown-heading' },
    h('h2', { id: 'focus-diff-breakdown-heading', textContent: i18n.t('panelBreakdownHeading') }),
    breakdownRows,
    h('p', { className: 'hint' }, i18n.t('panelCombineHint'), h('br'), i18n.t('timeHint', [LINES_PER_HOUR])),
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
  const panel = h('div', { className: 'panel' }, group, stats, breakdownToggle, settings, status);
  container.append(breakdown, panel);

  const options = () => [...group.querySelectorAll<HTMLButtonElement>('.option')];
  const pick = (id: string, event: MouseEvent | KeyboardEvent) => (event.shiftKey ? onToggle(id) : onSelect(id));

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
    pointAt(breakdown, breakdownToggle);
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
    if (!event.shiftKey && next.dataset.id) onSelect(next.dataset.id);
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

  const columns = () =>
    h(
      'div',
      { className: 'columns', 'aria-hidden': 'true' },
      h('span'),
      h('span', { textContent: i18n.t('panelColumnFilter') }),
      h('span', { textContent: i18n.t('panelColumnFiles') }),
      h('span', { textContent: i18n.t('panelColumnLines') }),
      h('span', { textContent: i18n.t('panelColumnTime') }),
    );

  const breakdownRow = (row: BreakdownRow, selected: boolean) => {
    const time = formatDuration(row.additions + row.deletions);
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
          format(row.additions),
          format(row.deletions),
          time,
        ]),
        onClick: (event: MouseEvent) => pick(row.id, event),
      },
      h('span', { className: 'row-check' }, selected ? checkIcon() : null),
      h('span', { className: 'row-name', textContent: row.name }),
      h('span', { className: 'row-files', textContent: format(row.visible) }),
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
      pointAt(breakdown, breakdownToggle);
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
          h('button', {
            type: 'button',
            className: 'option',
            textContent: name,
            'data-id': id,
            onClick: (event: MouseEvent) => pick(id, event),
          }),
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

  const renderStats = (totals: Totals) => {
    visibleFiles.set(totals.visible);
    totalFiles.set(totals.total);
    additions.set(totals.additions);
    deletions.set(totals.deletions);
    time.set(totals.additions + totals.deletions);
    pending.classList.toggle('active', totals.pending > 0);
    pending.title = totals.pending > 0 ? i18n.t('panelNotLoaded', [format(totals.pending)]) : '';
    stats.title = pending.title;
  };

  const announce = ({ name, visible, total, additions: added, deletions: removed, pending: waiting }: Totals & { name: string }) => {
    const parts = [
      i18n.t('panelAnnounce', [name, format(visible), format(total), format(added), format(removed)]),
      i18n.t('panelAnnounceTime', [formatDuration(added + removed)]),
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
  return { renderOptions, renderStats, renderBreakdown, announce, setVisible, reset };
};
