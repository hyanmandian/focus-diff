import { h, icon } from '@/utils/dom';

/** The tables in the breakdown and the guide share these pieces and the `.rows` styles in panel.css. */

export const checkIcon = () => icon('M3.5 8.5 6.5 11.5 12.5 4.5');

/** Five squares showing the share of added and removed lines. */
export const diffstat = (additions: number, deletions: number) => {
  const total = additions + deletions;
  const added = total ? Math.round((additions / total) * 5) : 0;
  const removed = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0;
  return h(
    'span',
    { className: 'diffstat', 'aria-hidden': 'true' },
    ...Array.from({ length: 5 }, (_, index) => h('span', { className: index < added ? 'add' : index < added + removed ? 'del' : '' })),
  );
};

export const columns = (labels: string[]) =>
  h('div', { className: 'columns', 'aria-hidden': 'true' }, h('span'), ...labels.map((label) => h('span', { textContent: label })));

export const lines = (additions: number, deletions: number, format: (value: number) => string) =>
  h(
    'span',
    { className: 'row-lines' },
    h('span', { className: 'additions', textContent: `+${format(additions)}` }),
    h('span', { className: 'deletions', textContent: `−${format(deletions)}` }),
    diffstat(additions, deletions),
  );
