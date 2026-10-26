// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScoreboard } from '@/components/scoreboard/scoreboard';

const shown = (element: HTMLElement) =>
  [...element.children].map((cell) => (cell.classList.contains('separator') ? `(${cell.textContent})` : `[${cell.textContent}]`)).join('');

describe('createScoreboard', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
  });

  it('lays a number out right-aligned on the cells of the widest one', () => {
    const board = createScoreboard('additions');
    board.set('+14,620', '+14,620');
    expect(shown(board.element)).toBe('[+][1][4](,)[6][2][0]');
    board.set('+5', '+14,620');
    expect(shown(board.element)).toBe('[][][]()[][+][5]');
    board.set('+2,525', '+14,620');
    expect(shown(board.element)).toBe('[][+][2](,)[5][2][5]');
  });

  it('keeps its cells when a number has a separator fewer than the widest', () => {
    // Portuguese leaves four-digit numbers ungrouped.
    const board = createScoreboard('additions');
    board.set('1234', '12.345');
    expect(shown(board.element)).toBe('[][1]()[2][3][4]');
  });

  it('shows a count and a clock with their separators in place', () => {
    const files = createScoreboard('files-count');
    files.set('1/12', '12/12');
    expect(shown(files.element)).toBe('[][1](/)[1][2]');
    const time = createScoreboard('time');
    time.set('–', '15:00');
    expect(shown(time.element)).toBe('[][]()[][–]');
    time.set('0:05', '15:00');
    expect(shown(time.element)).toBe('[][0](:)[0][5]');
  });

  it('grows to a number wider than the widest it was given', () => {
    const board = createScoreboard('additions');
    board.set('+1,000', '+999');
    expect(shown(board.element)).toBe('[+][1](,)[0][0][0]');
  });
});
