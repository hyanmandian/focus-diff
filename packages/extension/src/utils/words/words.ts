// What the background says itself (errors, notifications), in the language picked in Settings or else the browser's:
// English or Brazilian Portuguese, as the desktop's Rust says it (its tr!).

import { browser } from "wxt/browser";

export type Language = "en" | "pt-BR";

let picked: Language | null = null;

/** The browser's own language, as one of the app's. */
const browsers = (): Language => (browser.i18n.getUILanguage().toLowerCase().startsWith("pt") ? "pt-BR" : "en");

/** The language Settings picked ("system" for the browser's), from config.json's contents. */
export const followConfig = (config: string | null) => {
  let language: unknown;
  try {
    language = (JSON.parse(config ?? "{}") as { language?: unknown }).language;
  } catch {
    language = null;
  }
  picked = language === "en" || language === "pt-BR" ? language : null;
};

export const language = (): Language => picked ?? browsers();

/** The words in the language in use. */
export const tr = (english: string, portuguese: string): string => (language() === "pt-BR" ? portuguese : english);
