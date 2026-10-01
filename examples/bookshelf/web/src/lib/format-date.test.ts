import { formatDate } from './format-date';

it('formats', () => expect(formatDate('2026-09-30T12:00:00Z')).toBe('Sep 30, 2026'));
