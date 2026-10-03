import { icon } from '@/utils/dom';
import type { ThreadState } from '@/utils/github/github';

export const settingsIcon = () =>
  icon([
    ['path', { d: 'M2 4h7M13 4h1M2 8h1M7 8h7M2 12h5M11 12h3' }],
    ['circle', { cx: '11', cy: '4', r: '2' }],
    ['circle', { cx: '5', cy: '8', r: '2' }],
    ['circle', { cx: '9', cy: '12', r: '2' }],
  ]);
export const breakdownIcon = () => icon('M2 13.5h12M4 11V7M8 11V3M12 11V8');
export const infoIcon = () =>
  icon(
    [
      ['circle', { cx: '8', cy: '8', r: '6.25' }],
      ['path', { d: 'M8 7.25v3.75M8 5v.25' }],
    ],
    14,
  );
/** A check in a circle; the check is its own path so it can be drawn in. */
export const doneIcon = () =>
  icon(
    [
      ['circle', { cx: '8', cy: '8', r: '6.25' }],
      ['path', { d: 'M5.25 8.25 7.25 10.25 10.75 6.25', class: 'done-check' }],
    ],
    14,
  );
/** A page with a folded corner: the files left to review. */
export const fileIcon = () => icon('M9.25 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5zM9.25 1.75V5h3.25');
/** A plus over a minus: the lines changed. */
export const diffIcon = () => icon('M8 2.75v5M5.5 5.25h5M5.5 12.25h5');
/** A clock face: the time left to review. */
export const clockIcon = () =>
  icon([
    ['circle', { cx: '8', cy: '8', r: '6.25' }],
    ['path', { d: 'M8 4.75V8l2.25 1.5' }],
  ]);
export const checkIcon = () => icon('M3.5 8.5 6.5 11.5 12.5 4.5');
export const commentIcon = () => icon('M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z');
/** Crosshairs: go to the one thing there is. */
export const targetIcon = () =>
  icon([
    ['circle', { cx: '8', cy: '8', r: '4.25' }],
    ['path', { d: 'M8 1.5v2.25M8 12.25v2.25M1.5 8h2.25M12.25 8h2.25' }],
  ]);
/** A file with an arrow pointing on: the next file to review. */
export const nextFileIcon = () =>
  icon([
    ['path', { d: 'M9.25 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h3.25M9.25 1.75l3.25 3.25v2.75M9.25 1.75V5h3.25' }],
    ['path', { d: 'M9.5 11.75h5M12.5 9.75l2 2-2 2' }],
  ]);
export const closeIcon = () => icon('M4.5 4.5l7 7M11.5 4.5l-7 7', 14);
export const chevronIcon = (direction: 'left' | 'right') => icon(direction === 'left' ? 'M10 4.5 6.5 8 10 11.5' : 'M6 4.5 9.5 8 6 11.5');

/** A conversation waiting on the reader (a dot), answered (a reply arrow) or resolved (a check). */
export const threadStateIcons: Record<ThreadState, () => SVGSVGElement> = {
  waiting: () => icon([['circle', { cx: '8', cy: '8', r: '3.5', fill: 'currentColor', stroke: 'none' }]]),
  answered: () => icon('M6.5 4 3 7.5 6.5 11M3 7.5h6a4 4 0 0 1 4 4v.5'),
  resolved: () =>
    icon([
      ['circle', { cx: '8', cy: '8', r: '6.25' }],
      ['path', { d: 'M5.5 8.25 7.25 10l3.25-3.5' }],
    ]),
};
