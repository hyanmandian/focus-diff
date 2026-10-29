type Shelved<T> = { at: number; value: T };

const INDEX = "shelf-index";

function index() {
  const all = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX) ?? "{}");
    if (parsed && typeof parsed === "object")
      for (const [key, at] of Object.entries(parsed)) if (typeof at === "number") all.set(key, at);
  } catch {}
  return all;
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names what it shelved under the key
export function shelved<T>(key: string): { value: T; age: number } | null {
  try {
    const text = localStorage.getItem(`shelf:${key}`);
    if (!text) return null;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only shelve() writes here, with what the key's callers keep
    const kept = JSON.parse(text) as Shelved<T>;
    return { value: kept.value, age: Date.now() - kept.at };
  } catch {
    return null;
  }
}

export function shelve(key: string, value: unknown) {
  const MOST = 120;
  try {
    localStorage.setItem(`shelf:${key}`, JSON.stringify({ at: Date.now(), value }));
    const all = [...index().set(key, Date.now())].toSorted((a, b) => a[1] - b[1]);
    for (const [old] of all.slice(0, Math.max(0, all.length - MOST))) localStorage.removeItem(`shelf:${old}`);
    localStorage.setItem(INDEX, JSON.stringify(Object.fromEntries(all.slice(-MOST))));
  } catch {}
}

export async function cachedList<T>(
  key: string,
  fresh: number,
  load: () => Promise<T>,
  onValue: (value: T) => void,
): Promise<void> {
  const kept = shelved<T>(key);
  if (kept) onValue(kept.value);
  if (kept && kept.age < fresh) return;
  const value = await load();
  shelve(key, value);
  onValue(value);
}
