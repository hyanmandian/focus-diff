// The bar speaks the language picked in the app's Settings, as its windows do. The app's i18n remembers the pick in
// the page's storage and sets <html lang> for a page of its own; here the page is GitHub's, so both go back as they
// were.

import { setLanguage, type Language } from "@focus-diff/desktop/utils/i18n";

import { restoreHostPage } from "@/utils/host-page/host-page";

/** Where the app's i18n remembers the pick. */
const KEY = "language";

export const applyLanguage = (language: Language) => {
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(KEY);
  } catch {
    // Nothing to put back.
  }
  setLanguage(language);
  restoreHostPage();
  try {
    if (kept === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, kept);
  } catch {
    // The page's storage is off: nothing was written either.
  }
};
