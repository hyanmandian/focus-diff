import { useCallback, useState } from "react";

function stored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const text = localStorage.getItem(key);
    const value: unknown = text ? JSON.parse(text) : undefined;
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const isUpdate = <T>(next: T | ((v: T) => T)): next is (v: T) => T => typeof next === "function";
export function usePersisted<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => stored(key, fallback, valid));
  const set = useCallback(
    (next: T | ((v: T) => T)) => {
      setValue((v) => {
        const resolved = isUpdate(next) ? next(v) : next;
        store(key, resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set] as const;
}
