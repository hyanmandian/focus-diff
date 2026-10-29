export type Os = "macos" | "windows" | "linux";

const agent = navigator.userAgent;
export const os: Os = agent.includes("Windows")
  ? "windows"
  : agent.includes("Linux") && !agent.includes("Android")
    ? "linux"
    : "macos";
export const isMac = os === "macos";

export function shortcut(key: string, mods: Array<"ctrl" | "alt" | "shift" | "cmd"> = []) {
  if (isMac) return mods.map((m) => ({ ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" })[m]).join("") + key;
  return [...mods.map((m) => ({ ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Ctrl" })[m]), key].join("+");
}

export function written(keys: string) {
  if (isMac) return keys;
  const names: Record<string, string> = { "⌃": "Ctrl", "⌥": "Alt", "⇧": "Shift", "⌘": "Ctrl" };
  const key = keys.replace(/^[⌃⌥⇧⌘]+/u, "");
  const mods = Array.from(keys.slice(0, keys.length - key.length).matchAll(/./gu), (m) => names[m[0]]);
  return [...mods, key.replace("↩", "Enter")].join("+");
}

export const primary = (e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) => (isMac ? e.metaKey : e.ctrlKey);

const root = document.documentElement;
root.dataset.platform = os;

const follow = () => {
  root.toggleAttribute("data-window-inactive", !document.hasFocus());
};
window.addEventListener("focus", follow);
window.addEventListener("blur", follow);
follow();
