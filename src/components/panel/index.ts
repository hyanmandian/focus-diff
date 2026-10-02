import './panel.css';
import { i18n } from '#i18n';
import { settingsIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatDuration, formatNumber as format } from '@/utils/format';
import { createBreakdown, type BreakdownRow } from '@/components/breakdown';
import { createConversations, type Conversations } from '@/components/conversations';
import { createFilters, type PanelOption } from '@/components/filters';
import { createStats, type Totals } from '@/components/stats';
import { createUpdateNotice } from '@/components/update-notice';

/** What every part of the panel shares: where it's mounted, when it's torn down, and what has focus inside it. */
export interface PanelContext {
  host: HTMLElement;
  signal: AbortSignal;
  focused: () => HTMLElement | null;
}

export interface PanelActions {
  onToggle: (id: string) => void;
  onSettings: () => void;
  onComment: (step: 1 | -1) => void;
  /** The reader opened or dismissed the update notice. */
  onUpdateSeen: () => void;
}

export interface Panel {
  renderOptions: (options: PanelOption[], selected: string[]) => void;
  renderStats: (totals: Totals) => void;
  renderConversations: (conversations: Conversations) => void;
  /** Rows are only computed while the breakdown is open. */
  renderBreakdown: (rows: () => BreakdownRow[], selected: string[]) => void;
  announce: (summary: Totals & { name: string }) => void;
  /** Reads out a short message, like where a jump landed. */
  announceText: (text: string) => void;
  setVisible: (visible: boolean) => void;
  /** Points to the notes of a release the reader hasn't seen, or hides the notice with `null`. */
  showUpdate: (version: string | null) => void;
}

interface PanelMount {
  root: ShadowRoot;
  container: HTMLElement;
  host: HTMLElement;
  signal: AbortSignal;
}

/**
 * The floating bar: filters, stats, the breakdown, conversations, the update notice and settings, in that order. Each
 * part lives in its own module; this one lays them out and settles what they share, like which popover is open.
 */
export const createPanel = (
  { root, container, host, signal }: PanelMount,
  { onToggle, onSettings, onComment, onUpdateSeen }: PanelActions,
): Panel => {
  const context: PanelContext = { host, signal, focused: () => root.activeElement as HTMLElement | null };

  const settings = h('button', {
    type: 'button',
    className: 'settings icon-button',
    title: i18n.t('panelSettings'),
    onClick: () => onSettings(),
  });
  const filters = createFilters(context, onToggle);
  const stats = createStats(context);
  const breakdown = createBreakdown(context, { onToggle, onOpen: () => conversations.setOpen(false), fallback: settings });
  const conversations = createConversations(context, { onStep: onComment, onOpen: () => breakdown.setOpen(false), fallback: settings });
  const update = createUpdateNotice(context, { onSeen: onUpdateSeen, fallback: settings });
  const status = h('span', { className: 'visually-hidden', role: 'status' });
  // The breakdown follows its toggle so Tab moves straight into it; it's positioned against the host.
  container.append(
    h(
      'div',
      { className: 'panel' },
      filters.element,
      stats.element,
      breakdown.toggle,
      breakdown.popover,
      conversations.element,
      update.element,
      settings,
      status,
    ),
  );

  const resizeObserver = new ResizeObserver(() => {
    filters.moveIndicator();
    breakdown.reposition();
    conversations.reposition();
  });
  for (const element of [filters.element, breakdown.popover, conversations.popover]) resizeObserver.observe(element);
  signal.addEventListener('abort', () => resizeObserver.disconnect());

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || breakdown.dismiss()) return;
      // Escape elsewhere on the page belongs to GitHub, like cancelling a reply.
      if (conversations.isOpen() && context.focused()) conversations.setOpen(false);
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (breakdown.isOpen() && !event.composedPath().includes(host)) breakdown.setOpen(false);
    },
    { signal },
  );

  /** Without filters there's nothing to break down, and settings becomes a labelled call to set them up. */
  const renderOptions = (list: PanelOption[], selected: string[]) => {
    if (!filters.render(list, selected)) return;
    const configured = list.length > 1;
    settings.classList.toggle('labelled', !configured);
    breakdown.toggle.hidden = !configured;
    if (configured) {
      settings.replaceChildren(settingsIcon());
      settings.setAttribute('aria-label', i18n.t('panelSettings'));
    } else {
      settings.textContent = i18n.t('panelSetUp');
      settings.removeAttribute('aria-label');
      breakdown.setOpen(false);
    }
  };

  const announce = ({ name, visible, total, additions, deletions, pending, minutes }: Totals & { name: string }) => {
    const parts = [
      i18n.t('panelAnnounce', [name, format(visible), format(total), format(additions), format(deletions)]),
      i18n.t('panelAnnounceTime', [formatDuration(minutes)]),
    ];
    if (pending > 0) parts.push(i18n.t('panelAnnouncePartial', pending, [format(pending)]));
    status.textContent = parts.join(' ');
  };

  const setVisible = (visible: boolean) => {
    const display = visible ? '' : 'none';
    if (host.style.display === display) return;
    host.style.display = display;
    if (visible) requestAnimationFrame(filters.moveIndicator);
    else {
      breakdown.setOpen(false);
      conversations.setOpen(false);
    }
  };
  setVisible(false);

  return {
    renderOptions,
    renderStats: stats.render,
    renderConversations: conversations.render,
    renderBreakdown: breakdown.render,
    announce,
    announceText: (text) => (status.textContent = text),
    setVisible,
    showUpdate: update.show,
  };
};
