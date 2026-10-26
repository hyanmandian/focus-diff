import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import ptBR from '@/locales/pt_BR.json';

type Messages = Record<string, string | Record<string, string>>;

const placeholders = (value: string | Record<string, string>) =>
  [...JSON.stringify(value).matchAll(/\$(\d)/g)]
    .map(([, index]) => index)
    .toSorted()
    .join(',');

describe('translations', () => {
  it('cover every English message with the same placeholders', () => {
    const reference = en as Messages;
    const translated = ptBR as Messages;
    expect(Object.keys(translated).toSorted()).toEqual(Object.keys(reference).toSorted());
    for (const [key, value] of Object.entries(reference)) {
      expect(placeholders(translated[key] ?? ''), key).toBe(placeholders(value));
    }
  });
});
