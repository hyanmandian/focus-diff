const PREFIX = "typing:";
const KEPT = 50;
const memory = new Map<string, string>();

export function typed(key: string): string | null {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    const value = localStorage.getItem(PREFIX + key);
    const parsed: unknown = value === null ? null : JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && "text" in parsed && typeof parsed.text === "string"
      ? parsed.text
      : null;
  } catch {
    return null;
  }
}

function age(key: string) {
  try {
    const value: unknown = JSON.parse(String(localStorage.getItem(key)));
    return typeof value === "object" && value !== null && "at" in value && typeof value.at === "number" ? value.at : 0;
  } catch {
    return 0;
  }
}

export function keepTyping(key: string, text: string) {
  if (!text.trim()) {
    forgetTyping(key);
    return;
  }
  memory.set(key, text);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ text, at: Date.now() }));
    const kept = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    if (kept.length <= KEPT) return;
    for (const k of kept.toSorted((a, b) => age(a) - age(b)).slice(0, kept.length - KEPT)) localStorage.removeItem(k);
  } catch {}
}

export function forgetTyping(key: string) {
  memory.delete(key);
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
}

export function resetTyping() {
  memory.clear();
}
