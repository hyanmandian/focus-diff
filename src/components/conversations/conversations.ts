import './conversations.css';
import { i18n } from '#i18n';
import { chevronIcon, commentIcon, targetIcon, threadStateIcons } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatNumber as format } from '@/utils/format';
import type { PanelContext } from '@/components/panel/panel';
import { centreOver, returnFocus } from '@/components/popover';
import type { ThreadState } from '@/utils/github';

export interface Conversation {
  path: string;
  /** Line in the new version of the file, when known. */
  line: number | null;
  state: ThreadState;
}

export interface Conversations {
  list: Conversation[];
  /** The one the reader last jumped to, 1-based; 0 before the first jump. */
  current: number;
}

interface ConversationActions {
  onStep: (direction: 1 | -1) => void;
  /** Called as it opens, so other popovers can close. */
  onOpen: () => void;
  /** Where focus goes when it closes and its toggle is gone. */
  fallback: HTMLElement;
}

const STATE_LABEL = { waiting: 'panelStateWaiting', answered: 'panelStateAnswered', resolved: 'panelStateResolved' } as const;

/**
 * The conversations button and its card: which file and line the reader is on, whether it waits on them, and arrows to
 * the previous and next one. The card stays open while they step through.
 */
export const createConversations = ({ host, focused }: PanelContext, { onStep, onOpen, fallback }: ConversationActions) => {
  const count = h('span', { className: 'option-count', 'aria-hidden': 'true' });
  const toggle = h(
    'button',
    { type: 'button', className: 'comments', 'aria-expanded': 'false', 'aria-controls': 'focus-diff-conversations' },
    h('span', { className: 'comments-icon', 'aria-hidden': 'true' }, commentIcon()),
    count,
  );
  const icon = h('span', { className: 'conversation-icon', 'aria-hidden': 'true' });
  const file = h('span', { className: 'conversation-file' });
  const state = h('span', { className: 'conversation-state' });
  const position = h('span', { className: 'conversation-position', 'aria-hidden': 'true' });
  const step = (direction: 1 | -1) => {
    const label = i18n.t(direction > 0 ? 'panelNextComment' : 'panelPreviousComment');
    return h(
      'button',
      { type: 'button', className: 'icon-button step', 'aria-label': label, title: label, onClick: () => onStep(direction) },
      chevronIcon(direction > 0 ? 'right' : 'left'),
    );
  };
  const popover = h(
    'div',
    {
      className: 'conversations popover',
      id: 'focus-diff-conversations',
      role: 'dialog',
      'aria-label': i18n.t('panelComments'),
      hidden: true,
    },
    icon,
    file,
    state,
    position,
    h(
      'span',
      { className: 'conversation-steps' },
      step(-1),
      step(1),
      // With a single conversation there's nowhere to step to, only back to it.
      h(
        'button',
        {
          type: 'button',
          className: 'icon-button go-to',
          'aria-label': i18n.t('panelGoToComment'),
          title: i18n.t('panelGoToComment'),
          onClick: () => onStep(1),
        },
        targetIcon(),
      ),
    ),
  );
  // Like the breakdown, the card follows its toggle and is positioned against the host.
  const element = h('div', { className: 'navigation' }, toggle, popover);

  let source: Conversations = { current: 0, list: [] };

  /** The conversation the reader is on (the first one while the jump to it lands). */
  const draw = () => {
    if (popover.hidden) return;
    const { current, list } = source;
    const target = list[current - 1] ?? list[0];
    if (!target) return;
    const name = target.path.slice(target.path.lastIndexOf('/') + 1);
    // The name gives way to an ellipsis; the line number always shows.
    file.replaceChildren(
      h('span', { className: 'conversation-name', textContent: name }),
      target.line ? h('span', { className: 'conversation-line', textContent: `:${format(target.line)}` }) : '',
    );
    file.title = target.path;
    if (popover.dataset.state !== target.state) {
      popover.dataset.state = target.state;
      icon.replaceChildren(threadStateIcons[target.state]());
    }
    state.textContent = i18n.t(STATE_LABEL[target.state]);
    popover.toggleAttribute('data-single', list.length === 1);
    position.textContent = `${format(Math.max(current, 1))}/${format(list.length)}`;
  };

  const reposition = () => centreOver(popover, toggle, host);

  /** Only its toggle or Escape closes it. */
  const setOpen = (open: boolean) => {
    if (popover.hidden === !open) return;
    if (!open) returnFocus(popover, toggle, fallback, focused());
    popover.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      onOpen();
      // Opening lands on a conversation straight away, so the card always has one to show.
      if (source.current === 0) onStep(1);
      draw();
      reposition();
    }
  };
  toggle.addEventListener('click', () => {
    if (source.list.length) setOpen(popover.hidden);
  });

  const render = (conversations: Conversations) => {
    const total = conversations.list.length;
    // Without conversations it stays in place, disabled, so the bar keeps its shape; it stays focusable to explain why.
    toggle.setAttribute('aria-disabled', String(total === 0));
    toggle.title = total === 0 ? i18n.t('panelNoComments') : '';
    if (!total) setOpen(false);
    count.textContent = total ? format(total) : '';
    const where = !total
      ? i18n.t('panelNoComments')
      : conversations.current
        ? i18n.t('panelCommentPosition', [format(conversations.current), format(total)])
        : i18n.t('panelCommentCount', total, [format(total)]);
    toggle.setAttribute('aria-label', `${i18n.t('panelComments')}, ${where}`);
    source = conversations;
    draw();
  };

  return { element, popover, render, setOpen, reposition, isOpen: () => !popover.hidden };
};
