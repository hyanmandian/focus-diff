// Small things kept on this machine between windows: a pull request's commits and state around it,
// so a window shows them at once, and lists that rarely change (a repository's labels, the people
// who can be asked to review), so a picker opens full. Shown at once, then checked with GitHub.

type Shelved<T> = { at: number; value: T };

const INDEX = "shelf-index";

/** When each key was last kept. */
function index() {
  const all = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(INDEX) ?? "{}");
    if (parsed && typeof parsed === "object")
      for (const [key, at] of Object.entries(parsed)) if (typeof at === "number") all.set(key, at);
  } catch {
    // Lost track: what's on the shelf stays until written again.
  }
  return all;
}

/** What was kept under `key`, and how old it is, in milliseconds. */
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

/** Keeps `value` under `key`. The least recently kept go once there are more than `MOST`, so the
 *  shelf never fills the page's storage. */
export function shelve(key: string, value: unknown) {
  const MOST = 120;
  try {
    localStorage.setItem(`shelf:${key}`, JSON.stringify({ at: Date.now(), value }));
    const all = [...index().set(key, Date.now())].toSorted((a, b) => a[1] - b[1]);
    for (const [old] of all.slice(0, Math.max(0, all.length - MOST))) localStorage.removeItem(`shelf:${old}`);
    localStorage.setItem(INDEX, JSON.stringify(Object.fromEntries(all.slice(-MOST))));
  } catch {
    // Only slower next time.
  }
}

/** A list that rarely changes: what's kept comes at once (`onValue` right away), and GitHub is
 *  asked again when it's older than `fresh` milliseconds (`onValue` again with that). */
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
