import { browser } from "wxt/browser";

import { i18n } from "#i18n";

export const message = (key: string): string => (i18n.t as (key: string) => string)(key) || key;

export const uiLanguage = (): string => browser?.i18n?.getUILanguage?.() || navigator.language || "en-US";
