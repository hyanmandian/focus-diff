var FocusDiffPanel = (() => {
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
      --fd-focus: var(--focus-outlineColor, var(--color-accent-fg, #0969da));
      --fd-shadow: var(--shadow-floating-large, 0 0 0 1px rgba(209, 217, 224, 0.5), 0 24px 48px rgba(37, 41, 46, 0.2));
      --fd-font: var(--fontStack-sansSerif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif);
      --fd-target: 32px;
    }
    @media (pointer: coarse) { :host { --fd-target: 44px; } }

    .panel {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
      max-width: min(760px, calc(100vw - 32px)); padding: 6px;
      border: 1px solid var(--fd-border); border-radius: 12px;
      background: var(--fd-bg); box-shadow: var(--fd-shadow);
      color: var(--fd-fg); font: 500 13px/20px var(--fd-font);
    }
    .filters { display: flex; flex-wrap: wrap; gap: 2px; }
    button {
      min-height: var(--fd-target); padding: 0 12px; border: 0; border-radius: 8px;
      background: transparent; color: var(--fd-fg); font: inherit; cursor: pointer;
    }
    button:hover { background: var(--fd-hover); }
    button:focus-visible { outline: 2px solid var(--fd-focus); outline-offset: 1px; }
    [aria-checked="true"], [aria-checked="true"]:hover { background: var(--fd-selected-bg); color: var(--fd-selected-fg); font-weight: 600; }
    .stats {
      display: inline-flex; gap: 8px; padding: 0 4px 0 10px; border-left: 1px solid var(--fd-border);
      color: var(--fd-muted); font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .additions { color: var(--fd-add); }
    .pending { font-style: italic; }
    .deletions { color: var(--fd-del); }
    .settings { display: inline-grid; place-items: center; min-width: var(--fd-target); padding: 0; color: var(--fd-muted); }
    .settings.labelled { padding: 0 12px; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (prefers-reduced-motion: no-preference) { button { transition: background-color 120ms ease-out; } }
    @media (forced-colors: active) {
      .panel { border-color: CanvasText; }
      [aria-checked="true"] { outline: 2px solid Highlight; }
    }
  `;

  const SETTINGS_ICON = `
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M2 4h7M13 4h1M2 8h1M7 8h7M2 12h5M11 12h3"/>
      <circle cx="11" cy="4" r="2"/><circle cx="5" cy="8" r="2"/><circle cx="9" cy="12" r="2"/>
    </svg>`;

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

  const format = FocusDiff.formatNumber;

  const create = ({ onSelect, onSettings }) => {
    const host = h('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;display:none';
    const root = host.attachShadow({ mode: 'open' });

    const group = h('div', { className: 'filters', role: 'radiogroup', 'aria-label': 'Show files' });
    const stats = h('span', { className: 'stats' });
    const settings = h('button', { type: 'button', className: 'settings', title: 'Focus Diff settings', onClick: () => onSettings() });
    const status = h('span', { className: 'visually-hidden', role: 'status' });
    root.append(h('style', { textContent: STYLES }), h('div', { className: 'panel' }, group, stats, settings, status));
    document.documentElement.append(host);

    group.addEventListener('keydown', (event) => {
      const radios = [...group.children];
      const index = radios.indexOf(root.activeElement);
      if (index === -1) return;
      const target =
        event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : index + (ARROW_STEPS[event.key] ?? NaN);
      if (Number.isNaN(target)) return;
      event.preventDefault();
      const next = radios[(target + radios.length) % radios.length];
      next.focus();
      next.click();
    });

    let renderedKey = '';
    const renderOptions = (options, active) => {
      const key = JSON.stringify([options.map(({ id, name }) => [id, name]), active]);
      if (key === renderedKey) return;
      renderedKey = key;
      const keepFocus = group.contains(root.activeElement);

      group.replaceChildren(
        ...options.map(({ id, name }) =>
          h('button', {
            type: 'button',
            role: 'radio',
            'aria-checked': String(id === active),
            tabIndex: id === active ? 0 : -1,
            textContent: name,
            onClick: () => onSelect(id),
          }),
        ),
      );
      if (keepFocus) group.querySelector('[aria-checked="true"]').focus();

      const configured = options.length > 1;
      settings.classList.toggle('labelled', !configured);
      if (configured) {
        settings.innerHTML = SETTINGS_ICON;
        settings.setAttribute('aria-label', 'Focus Diff settings');
      } else {
        settings.textContent = 'Set up filters';
        settings.removeAttribute('aria-label');
      }
    };

    let statsKey = '';
    const renderStats = ({ visible, total, additions, deletions, pending }) => {
      const key = [visible, total, additions, deletions, pending].join('|');
      if (key === statsKey) return;
      statsKey = key;
      const figure = (className, value, label) =>
        h('span', { className }, value, h('span', { className: 'visually-hidden', textContent: ` ${label}` }));

      stats.replaceChildren(h('span', { textContent: `${format(visible)}/${format(total)} files` }));
      stats.append(
        figure('additions', `+${format(additions)}`, 'lines added'),
        figure('deletions', `−${format(deletions)}`, 'lines removed'),
      );
      if (pending > 0) {
        stats.append(h('span', { className: 'pending', textContent: `${format(pending)} not loaded yet` }));
      }
    };

    const announce = ({ name, visible, total, additions, deletions, pending }) => {
      const loading = pending > 0 ? ` ${format(pending)} of them haven't loaded yet, so line counts are partial.` : '';
      status.textContent = `${name}: ${format(visible)} of ${format(total)} files, ${format(additions)} lines added, ${format(deletions)} removed.${loading}`;
    };

    const setVisible = (visible) => {
      if (visible && !host.isConnected) document.documentElement.append(host);
      host.style.display = visible ? 'block' : 'none';
    };

    const reset = () => {
      renderedKey = '';
    };

    return { renderOptions, renderStats, announce, setVisible, reset };
  };

  return { create };
})();
