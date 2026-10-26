// Which desktop the app runs on, for what differs between them: the design system's tokens
// (@focus-diff/design-system/styles/tokens.css) follow <html data-platform>, and the few behaviours
// tokens can't say (shortcut glyphs) come from here.
// Set as soon as this loads (utils/theme/theme.ts brings it into every page), before anything is drawn.

export type Platform = "macos" | "windows" | "linux";

// The web view reports the system it's part of: WKWebView says Macintosh, WebView2 Windows,
// WebKitGTK Linux. Anything else is treated as the Mac, the default token set.
const agent = navigator.userAgent;
export const platform: Platform = agent.includes("Windows")
  ? "windows"
  : agent.includes("Linux") && !agent.includes("Android")
    ? "linux"
    : "macos";
export const isMac = platform === "macos";

/** A shortcut as the platform writes it: ⌘↩ on the Mac, Ctrl+Enter elsewhere. `mods` in the Mac's
 *  order (⌃⌥⇧⌘). */
export function shortcut(key: string, mods: Array<"ctrl" | "alt" | "shift" | "cmd"> = []) {
  if (isMac) return mods.map((m) => ({ ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" })[m]).join("") + key;
  return [...mods.map((m) => ({ ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Ctrl" })[m]), key].join("+");
}

const root = document.documentElement;
root.dataset.platform = platform;

// A window that isn't the key one draws its selection and accent controls in gray, as AppKit's do
// (the design system's tokens, [data-window-inactive]). The web view's own focus follows the window's.
const follow = () => {
  root.toggleAttribute("data-window-inactive", !document.hasFocus());
};
window.addEventListener("focus", follow);
window.addEventListener("blur", follow);
follow();
