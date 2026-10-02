import './update-notice.css';
import { i18n } from '#i18n';
import { closeIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import type { PanelContext } from '@/components/panel/panel';

const RELEASES = 'https://github.com/hyanmandian/focus-diff/releases/tag/v';

/** "New in 1.1", linking to that release's notes, until the reader opens or dismisses it. */
export const createUpdateNotice = ({ focused }: PanelContext, { onSeen, fallback }: { onSeen: () => void; fallback: HTMLElement }) => {
  const text = h('span');
  const link = h(
    'a',
    { className: 'update-link', target: '_blank', rel: 'noopener', onClick: () => onSeen() },
    h('span', { className: 'update-dot', 'aria-hidden': 'true' }),
    text,
  );
  const element = h(
    'div',
    { className: 'update', hidden: true },
    link,
    h(
      'button',
      {
        type: 'button',
        className: 'icon-button update-dismiss',
        'aria-label': i18n.t('panelUpdateDismiss'),
        title: i18n.t('panelUpdateDismiss'),
        onClick: () => onSeen(),
      },
      closeIcon(),
    ),
  );

  const show = (version: string | null) => {
    if (!version) {
      if (element.contains(focused())) fallback.focus();
      element.hidden = true;
      return;
    }
    link.href = `${RELEASES}${version}`;
    text.textContent = i18n.t('panelUpdate', [version.split('.').slice(0, 2).join('.')]);
    element.hidden = false;
  };

  return { element, show };
};
