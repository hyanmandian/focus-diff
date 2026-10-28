// Keyboard behavior shared by the app's own widgets.

import type { KeyboardEvent } from "react";

/** Arrow keys, Home and End move between a tablist's tabs, choosing the one they land on (the
 *  WAI-ARIA tabs pattern); Tab then goes into the chosen panel. Put on the role="tablist". */
export function tabKeys(e: KeyboardEvent<HTMLElement>) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')];
  const at = tabs.findIndex((tab) => tab === document.activeElement);
  if (at < 0) return;
  const next = {
    ArrowRight: at + 1,
    ArrowDown: at + 1,
    ArrowLeft: at - 1,
    ArrowUp: at - 1,
    Home: 0,
    End: tabs.length - 1,
  }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const tab = tabs[(next + tabs.length) % tabs.length];
  tab?.focus();
  tab?.click();
}

export const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(el.tagName));
