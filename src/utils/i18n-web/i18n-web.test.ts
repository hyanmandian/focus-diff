import { describe, expect, it } from 'vitest';
import { createWebI18n } from './i18n-web';

describe('createWebI18n', () => {
  it('fills placeholders and picks plural forms like the extension', () => {
    const { t } = createWebI18n('en-US');
    expect(t('filterAll')).toBe('All');
    expect(t('panelFilesLeft', 1, ['1'])).toBe('1 file left to review');
    expect(t('panelFilesLeft', 9, ['9'])).toBe('9 files left to review');
    expect(t('panelJumpedToComment', ['2', '3', 'docs/a.md'])).toBe('Conversation 2 of 3, in docs/a.md.');
  });

  it('speaks Brazilian Portuguese, and English for languages it lacks', () => {
    expect(createWebI18n('pt-BR').t('filterAll')).toBe('Todos');
    expect(createWebI18n('de-DE').t('filterAll')).toBe('All');
  });
});
