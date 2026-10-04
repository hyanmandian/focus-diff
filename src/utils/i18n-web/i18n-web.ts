import en from '@/locales/en.json';
import ptBR from '@/locales/pt_BR.json';

type Messages = Record<string, string | Record<string, string>>;

const ENGLISH: Messages = en;
const LOCALES: Record<string, Messages> = { en: ENGLISH, pt: ptBR };

/** The messages for a language, by its first part; English for any other. */
const messagesFor = (language: string): Messages => LOCALES[language.toLowerCase().split('-')[0] ?? ''] ?? ENGLISH;

/**
 * The extension's messages for a web page, where there's no `browser.i18n`: what the demo reads through `#i18n` when it's
 * built for the site. It follows WXT's `i18n.t`: a number picks the plural form and fills $1, a list fills $1 to $9.
 */
export const createWebI18n = (language: string) => {
  const messages = messagesFor(language);
  const t = (key: string, ...args: unknown[]): string => {
    const count = args.find((arg): arg is number => typeof arg === 'number');
    const substitutions = args.find((arg): arg is unknown[] => Array.isArray(arg)) ?? (count === undefined ? [] : [count]);
    const value = messages[key] ?? ENGLISH[key] ?? '';
    const text =
      typeof value === 'string'
        ? value
        : ((count === 0 ? value['0'] : undefined) ?? (count === 1 ? value['1'] : undefined) ?? value.n ?? '');
    return text.replace(/\$(\d)/g, (_match: string, index: string) => String(substitutions[Number(index) - 1] ?? ''));
  };
  return { t };
};

/** @public Stands in for `#i18n` in the demo's build for web pages (vite.demo.config.ts). */
export const i18n = createWebI18n(typeof navigator === 'undefined' ? 'en' : navigator.language);
