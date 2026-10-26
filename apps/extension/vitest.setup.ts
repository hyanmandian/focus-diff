import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import en from '@/locales/en.json';

const messages: Record<string, string> = Object.fromEntries(
  Object.entries(en).map(([key, value]) => [key, typeof value === 'string' ? value : Object.values(value).join(' | ')]),
);

const getMessage = (key: string, substitutions?: string | string[]) =>
  (messages[key] ?? '').replace(/\$(\d)/g, (_, index: string) => [substitutions ?? []].flat()[Number(index) - 1] ?? '');

beforeEach(() => {
  fakeBrowser.reset();
  Object.assign(fakeBrowser.i18n, { getMessage, getUILanguage: () => 'en-US' });
});
