import './next-file.css';
import { i18n } from '#i18n';
import { nextFileIcon } from '@/components/icons';
import { h } from '@/utils/dom';
import { formatNumber as format } from '@/utils/format';

/** What's left to review: files in the shown filters, or else the next filter in the bar that still has some. */
export interface NextFile {
  left: number;
  nextFilter?: { name: string; left: number };
}

/**
 * The button before the filters that goes to the next file left to review. Once the shown files are all viewed, it
 * moves on to the next filter that has some; with nothing left anywhere, it's disabled and its tooltip says so.
 */
export const createNextFile = (onNext: () => void) => {
  const element = h(
    'button',
    {
      type: 'button',
      className: 'icon-button next-file',
      'aria-keyshortcuts': 'Alt+Shift+J',
      onClick: () => element.getAttribute('aria-disabled') !== 'true' && onNext(),
    },
    nextFileIcon(),
  );

  const render = ({ left, nextFilter }: NextFile) => {
    const label = left
      ? i18n.t('panelNextFile', left, [format(left)])
      : nextFilter
        ? i18n.t('panelNextFilter', nextFilter.left, [nextFilter.name, format(nextFilter.left)])
        : i18n.t('panelAllReviewed');
    element.setAttribute('aria-label', label);
    element.dataset.tip = label;
    element.setAttribute('aria-disabled', String(!left && !nextFilter));
  };

  return { element, render };
};
