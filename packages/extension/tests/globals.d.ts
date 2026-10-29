import type { browser } from "wxt/browser";

declare global {
  const chrome: typeof browser;
}
