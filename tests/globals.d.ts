import type { Browser } from 'wxt/browser';

declare global {
  /** Code passed to `background.evaluate` runs in the extension's service worker, where `chrome` exists. */
  const chrome: Browser;
}
