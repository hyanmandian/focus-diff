import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatNumber } from '@/utils/format';

describe('formatDuration', () => {
  it('rounds to minutes, then to five minute steps past an hour', () => {
    expect(formatDuration(0.4)).toBe('<1 min');
    expect(formatDuration(7.5)).toBe('~8 min');
    expect(formatDuration(60)).toBe('~1 h');
    expect(formatDuration(79.5)).toBe('~1 h 20 min');
  });
});

describe('formatClock', () => {
  it('shows the same steps as h:mm', () => {
    expect(formatClock(0.4)).toBe('0:01');
    expect(formatClock(7.5)).toBe('0:08');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(79.5)).toBe('1:20');
    expect(formatClock(250)).toBe('4:10');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(12345)).toBe('12,345');
  });
});
