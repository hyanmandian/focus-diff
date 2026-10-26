import { i18n } from '#i18n';
import { browser } from 'wxt/browser';

/** Looks up a message whose key is only known at runtime, like `data-i18n` attributes and recipe names. */
export const message = (key: string): string => (i18n.t as (key: string) => string)(key) || key;

/** The browser's language; on a web page, like the site's demo, there's no extension API, so the page's. */
export const uiLanguage = (): string => browser?.i18n?.getUILanguage?.() || navigator.language || 'en-US';
