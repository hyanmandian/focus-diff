import { formatDate, pluralize } from './format';

describe('format', () => {
  it('formats dates', () => expect(formatDate('2026-09-30T12:00:00Z')).toBe('Sep 30, 2026'));
  it('pluralizes', () => {
    expect(pluralize(1, 'book')).toBe('1 book');
    expect(pluralize(3, 'book')).toBe('3 books');
  });
});
