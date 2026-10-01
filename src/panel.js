var FocusDiffPanel = (() => {
  const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const COUNT_MS = 360;

  const STYLES = `
    :host {
      all: initial;
      --fd-bg: var(--overlay-bgColor, var(--color-canvas-overlay, #ffffff));
      --fd-border: var(--borderColor-default, var(--color-border-default, #d1d9e0));
      --fd-fg: var(--fgColor-default, var(--color-fg-default, #1f2328));
      --fd-muted: var(--fgColor-muted, var(--color-fg-muted, #59636e));
      --fd-hover: var(--control-transparent-bgColor-hover, var(--color-action-list-item-default-hover-bg, rgba(129, 139, 152, 0.15)));
      --fd-selected-bg: var(--bgColor-accent-emphasis, var(--color-accent-emphasis, #0969da));
      --fd-selected-fg: var(--fgColor-onEmphasis, var(--color-fg-on-emphasis, #ffffff));
      --fd-add: var(--fgColor-success, var(--color-success-fg, #1a7f37));
      --fd-del: var(--fgColor-danger, var(--color-danger-fg, #d1242f));
      --fd-attention: var(--fgColor-attention, var(--color-attention-fg, #9a6700));
      --fd-focus: var(--focus-outlineColor, var(--color-accent-fg, #0969da));
      --fd-shadow: var(--shadow-floating-large, 0 0 0 1px rgba(209, 217, 224, 0.5), 0 24px 48px rgba(37, 41, 46, 0.2));
      --fd-mono: var(--fontStack-monospace, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace);
      --fd-font: var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
      --fd-target: 32px;
      --fd-ease: ${EASE_OUT};
    }
    @media (pointer: coarse) { :host { --fd-target: 44px; } }

    .panel {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      max-width: min(760px, calc(100vw - 32px)); padding: 6px;
      border: 1px solid var(--fd-border); border-radius: 12px;
      background: var(--fd-bg); box-shadow: var(--fd-shadow);
      color: var(--fd-fg); font: 500 13px/20px var(--fd-font);
    }

    .filters { position: relative; display: flex; flex-wrap: wrap; gap: 2px; isolation: isolate; }
    .indicator {
      position: absolute; top: 0; left: 0; z-index: -1; border-radius: 8px;
      background: var(--fd-selected-bg); pointer-events: none;
    }
    button {
      min-height: var(--fd-target); padding: 0 12px; border: 0; border-radius: 8px;
      background: transparent; color: var(--fd-fg); font: inherit; cursor: pointer;
    }
    button:hover { background: var(--fd-hover); }
    button:focus-visible { outline: 2px solid var(--fd-focus); outline-offset: 1px; }
    .option[aria-pressed="true"], .option[aria-pressed="true"]:hover { background: transparent; color: var(--fd-selected-fg); }
    .filters.combined .indicator { opacity: 0; }
    .filters.combined .option[aria-pressed="true"] { background: var(--fd-selected-bg); }

    .icon-button { display: inline-grid; place-items: center; min-width: var(--fd-target); padding: 0; color: var(--fd-muted); }
    .icon-button[aria-expanded="true"] { background: var(--fd-hover); color: var(--fd-fg); }

    .breakdown {
      position: absolute; right: 0; bottom: calc(100% + 8px); width: max-content; min-width: 100%; max-width: min(560px, calc(100vw - 32px));
      padding: 8px; border: 1px solid var(--fd-border); border-radius: 12px; background: var(--fd-bg); box-shadow: var(--fd-shadow);
      color: var(--fd-fg); font: 500 13px/20px var(--fd-font);
    }
    .breakdown[hidden] { display: none; }
    .breakdown h2 { margin: 4px 8px 8px; font: 600 12px/16px var(--fd-font); color: var(--fd-muted); }
    .rows { display: grid; grid-template-columns: auto auto auto auto 72px; }
    .row {
      display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; column-gap: 16px;
      text-align: right; white-space: nowrap;
    }
    .row > span:first-child { text-align: left; }
    .row .metric { font: 500 12px/20px var(--fd-mono); color: var(--fd-muted); }
    .row[aria-pressed="true"] { color: var(--fd-selected-bg); font-weight: 600; }
    .row[aria-pressed="true"]:hover { background: var(--fd-hover); }
    .bar { display: block; height: 6px; border-radius: 3px; background: currentColor; opacity: 0.35; }
    .row[aria-pressed="true"] .bar { opacity: 0.8; }
    .hint { margin: 8px 8px 2px; font-size: 12px; color: var(--fd-muted); }

    .stats {
      display: inline-flex; align-items: center; gap: 8px; padding: 0 4px 0 10px;
      border-left: 1px solid var(--fd-border); color: var(--fd-muted);
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .files { display: inline-flex; align-items: baseline; }
    .files-label { margin-left: 0.35em; }
    .number { display: inline-grid; font: 500 12px/20px var(--fd-mono); letter-spacing: -0.01em; }
    .number > * { grid-area: 1 / 1; }
    .ghost { visibility: hidden; }
    .visible { justify-items: end; }
    .additions { color: var(--fd-add); }
    .deletions { color: var(--fd-del); }
    .pending {
      width: 6px; height: 6px; border-radius: 50%; background: var(--fd-attention);
      opacity: 0; transition: opacity 200ms ease-out;
    }
    .pending.active { opacity: 1; }

    .settings.labelled { padding: 0 12px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    @media (prefers-reduced-motion: no-preference) {
      .panel { transition: opacity 200ms ease-out, translate 280ms var(--fd-ease); }
      @starting-style { .panel { opacity: 0; translate: 0 8px; } }
      .breakdown { transition: opacity 160ms ease-out, translate 220ms var(--fd-ease); }
      @starting-style { .breakdown { opacity: 0; translate: 0 6px; } }
      .indicator.ready { transition: translate 260ms var(--fd-ease), width 260ms var(--fd-ease), height 260ms var(--fd-ease); }
      button { transition: background-color 120ms ease-out, color 160ms ease-out; }
    }
    @media (forced-colors: active) {
      .panel { border-color: CanvasText; }
      .indicator { background: Highlight; }
      .option[aria-pressed="true"] { color: HighlightText; }
      .row[aria-pressed="true"] { outline: 2px solid Highlight; }
      .filters.combined .option[aria-pressed="true"] { background: Highlight; }
    }
  `;

  const SVG = 'http://www.w3.org/2000/svg';
  const settingsIcon = () => {
    const svg = document.createElementNS(SVG, 'svg');
    const attributes = { viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' };
    Object.entries(attributes).forEach(([name, value]) => svg.setAttribute(name, value));
    const shapes = [
      ['path', { d: 'M2 4h7M13 4h1M2 8h1M7 8h7M2 12h5M11 12h3' }],
      ['circle', { cx: '11', cy: '4', r: '2' }],
      ['circle', { cx: '5', cy: '8', r: '2' }],
      ['circle', { cx: '9', cy: '12', r: '2' }],
    ];
    for (const [tag, shapeAttributes] of shapes) {
      const shape = document.createElementNS(SVG, tag);
      Object.entries(shapeAttributes).forEach(([name, value]) => shape.setAttribute(name, value));
      svg.append(shape);
    }
    return svg;
  };

  const breakdownIcon = () => {
    const svg = document.createElementNS(SVG, 'svg');
    const attributes = { viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'aria-hidden': 'true', focusable: 'false' };
    Object.entries(attributes).forEach(([name, value]) => svg.setAttribute(name, value));
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M2 13.5h12M4 11V7M8 11V3M12 11V8');
    svg.append(path);
    return svg;
  };

  const ARROW_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

  const h = (tag, props = {}, ...children) => {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key.includes('-') || key === 'role') element.setAttribute(key, value);
      else element[key] = value;
    }
    element.append(...children);
    return element;
  };

  const { formatNumber: format, t } = FocusDiff;
  const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOutExpo = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));

  const counter = (className, render) => {
    const ghost = h('span', { className: 'ghost', 'aria-hidden': 'true' });
    const output = h('span');
    const element = h('span', { className: `number ${className}` }, ghost, output);
    let value = null;
    let frame = 0;

    const reserve = (text) => {
      if (text.length > ghost.textContent.length) ghost.textContent = text;
    };

    const paint = (current) => {
      output.textContent = render(current);
    };

    const set = (next) => {
      if (next === value) return;
      cancelAnimationFrame(frame);
      const from = value;
      value = next;
      reserve(render(Math.max(from ?? 0, next)));
      if (from === null || prefersReducedMotion()) return paint(next);
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / COUNT_MS);
        paint(Math.round(from + (next - from) * easeOutExpo(progress)));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    return { element, set };
  };

  const create = ({ onSelect, onToggle, onSettings }) => {
    const host = h('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;display:none';
    const root = host.attachShadow({ mode: 'open' });

    const indicator = h('span', { className: 'indicator', 'aria-hidden': 'true' });
    const group = h('div', { className: 'filters', role: 'group', 'aria-label': t('panelShowFiles') }, indicator);
    const visibleFiles = counter('visible', format);
    const totalFiles = counter('total', format);
    const additions = counter('additions', (n) => `+${format(n)}`);
    const deletions = counter('deletions', (n) => `−${format(n)}`);
    const time = counter('time', FocusDiff.formatDuration);
    const pending = h('span', { className: 'pending', 'aria-hidden': 'true' });
    const stats = h(
      'span',
      { className: 'stats' },
      h('span', { className: 'files' }, visibleFiles.element, h('span', { className: 'number', textContent: '/' }), totalFiles.element, h('span', { className: 'files-label', textContent: ` ${t('panelFilesLabel')}` })),
      additions.element,
      h('span', { className: 'visually-hidden', textContent: ` ${t('panelLinesAdded')}` }),
      deletions.element,
      h('span', { className: 'visually-hidden', textContent: ` ${t('panelLinesRemoved')}` }),
      h('span', { className: 'time-wrap', title: t('timeHint', FocusDiff.LINES_PER_HOUR) }, time.element, h('span', { className: 'visually-hidden', textContent: ` ${t('panelTimeLabel')}` })),
      pending,
    );

    const breakdownRows = h('div', { className: 'rows' });
    const breakdown = h(
      'div',
      { className: 'breakdown', id: 'focus-diff-breakdown', hidden: true },
      h('h2', { textContent: t('panelBreakdownHeading') }),
      breakdownRows,
      h('p', { className: 'hint', textContent: t('panelCombineHint') }),
    );
    const breakdownToggle = h('button', {
      type: 'button',
      className: 'icon-button',
      title: t('panelBreakdown'),
      'aria-label': t('panelBreakdown'),
      'aria-expanded': 'false',
      'aria-controls': 'focus-diff-breakdown',
    }, breakdownIcon());
    const settings = h('button', { type: 'button', className: 'settings icon-button', title: t('panelSettings'), onClick: () => onSettings() });
    const status = h('span', { className: 'visually-hidden', role: 'status' });
    const panel = h('div', { className: 'panel' }, group, stats, breakdownToggle, settings, status);
    root.append(h('style', { textContent: STYLES }), breakdown, panel);
    document.documentElement.append(host);

    const options = () => [...group.querySelectorAll('.option')];
    const pick = (id, event) => (event.shiftKey ? onToggle(id) : onSelect(id));

    const moveIndicator = () => {
      const pressed = group.querySelectorAll('[aria-pressed="true"]');
      group.classList.toggle('combined', pressed.length > 1);
      const target = pressed[0];
      if (pressed.length !== 1 || !target.offsetWidth) return;
      indicator.style.width = `${target.offsetWidth}px`;
      indicator.style.height = `${target.offsetHeight}px`;
      indicator.style.translate = `${target.offsetLeft}px ${target.offsetTop}px`;
      if (!indicator.classList.contains('ready')) requestAnimationFrame(() => indicator.classList.add('ready'));
    };
    new ResizeObserver(moveIndicator).observe(group);

    group.addEventListener('keydown', (event) => {
      const list = options();
      const index = list.indexOf(root.activeElement);
      if (index === -1) return;
      const target =
        event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : index + (ARROW_STEPS[event.key] ?? NaN);
      if (Number.isNaN(target)) return;
      event.preventDefault();
      const next = list[(target + list.length) % list.length];
      list.forEach((option) => (option.tabIndex = option === next ? 0 : -1));
      next.focus();
      if (!event.shiftKey) onSelect(next.dataset.id);
    });

    let breakdownData = { rows: [], selected: [] };
    let drawnKey = '';
    const drawBreakdown = () => {
      const key = JSON.stringify(breakdownData);
      if (breakdown.hidden || key === drawnKey) return;
      drawnKey = key;
      const { rows, selected } = breakdownData;
      const widest = Math.max(1, ...rows.map((row) => row.additions + row.deletions));
      const keepFocus = root.activeElement?.dataset.row;
      breakdownRows.replaceChildren(
        ...rows.map((row) => {
          const bar = h('span', { className: 'bar' });
          bar.style.width = `${Math.max(4, ((row.additions + row.deletions) / widest) * 100)}%`;
          const cells = [
            h('span', { textContent: row.name }),
            h('span', { className: 'metric', textContent: t(row.visible === 1 ? 'breakdownFile' : 'breakdownFiles', format(row.visible)) }),
            h('span', { className: 'metric' }, h('span', { className: 'additions', textContent: `+${format(row.additions)}` }), ' ', h('span', { className: 'deletions', textContent: `−${format(row.deletions)}` })),
            h('span', { className: 'metric', textContent: FocusDiff.formatDuration(row.additions + row.deletions) }),
          ];
          return h(
            'button',
            { type: 'button', className: 'row', 'data-row': row.id, 'aria-pressed': String(selected.includes(row.id)), onClick: (event) => pick(row.id, event) },
            ...cells.flatMap((cell) => [cell, h('span', { className: 'visually-hidden', textContent: ', ' })]).slice(0, -1),
            h('span', { 'aria-hidden': 'true' }, bar),
          );
        }),
      );
      if (keepFocus) breakdownRows.querySelector(`[data-row="${CSS.escape(keepFocus)}"]`)?.focus();
    };

    const setBreakdownOpen = (open) => {
      breakdown.hidden = !open;
      breakdownToggle.setAttribute('aria-expanded', String(open));
      if (open) drawBreakdown();
      else drawnKey = '';
    };
    breakdownToggle.addEventListener('click', () => setBreakdownOpen(breakdown.hidden));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || breakdown.hidden) return;
      const focusInside = breakdown.contains(root.activeElement);
      setBreakdownOpen(false);
      if (focusInside) breakdownToggle.focus();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!breakdown.hidden && !event.composedPath().includes(host)) setBreakdownOpen(false);
    });

    let optionsKey = '';
    const renderOptions = (list, selected) => {
      const key = JSON.stringify(list.map(({ id, name }) => [id, name]));
      if (key !== optionsKey) {
        optionsKey = key;
        const keepFocus = group.contains(root.activeElement);
        options().forEach((option) => option.remove());
        group.append(
          ...list.map(({ id, name }) =>
            h('button', { type: 'button', className: 'option', textContent: name, 'data-id': id, onClick: (event) => pick(id, event) }),
          ),
        );
        if (keepFocus) requestAnimationFrame(() => group.querySelector('[aria-pressed="true"]')?.focus());

        const configured = list.length > 1;
        settings.classList.toggle('labelled', !configured);
        breakdownToggle.hidden = !configured;
        if (configured) {
          settings.replaceChildren(settingsIcon());
          settings.setAttribute('aria-label', t('panelSettings'));
        } else {
          settings.textContent = t('panelSetUp');
          settings.removeAttribute('aria-label');
          setBreakdownOpen(false);
        }
      }

      const focused = root.activeElement?.classList.contains('option') ? root.activeElement : null;
      for (const option of options()) {
        const pressed = selected.includes(option.dataset.id);
        if (option.getAttribute('aria-pressed') !== String(pressed)) option.setAttribute('aria-pressed', String(pressed));
        option.tabIndex = (focused ? option === focused : option.dataset.id === selected[0]) ? 0 : -1;
      }
      moveIndicator();
    };

    const renderBreakdown = (rows, selected) => {
      breakdownData = { rows, selected };
      drawBreakdown();
    };

    const renderStats = (totals) => {
      visibleFiles.set(totals.visible);
      totalFiles.set(totals.total);
      additions.set(totals.additions);
      deletions.set(totals.deletions);
      time.set(totals.additions + totals.deletions);
      pending.classList.toggle('active', totals.pending > 0);
      pending.title = totals.pending > 0 ? t('panelNotLoaded', format(totals.pending)) : '';
      stats.title = pending.title;
    };

    const announce = ({ name, visible, total, additions: added, deletions: removed, pending: waiting }) => {
      const parts = [
        t('panelAnnounce', name, format(visible), format(total), format(added), format(removed)),
        t('panelAnnounceTime', FocusDiff.formatDuration(added + removed)),
      ];
      if (waiting > 0) parts.push(t('panelAnnouncePartial', format(waiting)));
      status.textContent = parts.join(' ');
    };

    const setVisible = (visible) => {
      if (visible && !host.isConnected) document.documentElement.append(host);
      const display = visible ? 'block' : 'none';
      if (host.style.display === display) return;
      host.style.display = display;
      if (visible) requestAnimationFrame(moveIndicator);
      else setBreakdownOpen(false);
    };

    const reset = () => {
      optionsKey = '';
      drawnKey = '';
    };

    const remove = () => host.remove();

    return { renderOptions, renderStats, renderBreakdown, announce, setVisible, reset, remove };
  };

  return { create };
})();
