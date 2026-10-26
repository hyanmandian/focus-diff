// The app's words in English and Brazilian Portuguese. English (src/locales/en) is the source of
// truth: its keys and placeholders type every call, and the Portuguese dictionary must have the
// same keys (src/locales/pt-BR, checked by the compiler and by i18n.test.ts). No library: a key
// is "namespace.name", a value is a string with {placeholders} or plural forms picked by
// Intl.PluralRules from `count`.
//
// Components read the words through useT(), so the React Compiler sees the translator as an input
// and a language change re-renders what it changed, in every open window, without remounting.

import { durationParts } from "@focus-diff/core/duration";
import { useSyncExternalStore } from "react";

import { en } from "@/locales/en/index";
import { ptBR } from "@/locales/pt-BR/index";

export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
/** What Settings → General offers: the system's language, or one picked. */
export type Language = "system" | Locale;
export const LANGUAGES = ["system", ...LOCALES] as const satisfies readonly Language[];

/** Plural forms, as Intl.PluralRules names them. `zero`, when given, is used for 0 whatever the
 *  language's rules say ("Nothing yet" reads better than "0 files"). */
export type Plural = { zero?: string; one: string; other: string; many?: string };

type English = typeof en;
type Namespace = Extract<keyof English, string>;
export type Key = { [N in Namespace]: `${N}.${keyof English[N] & string}` }[Namespace];
type Value<K extends Key> = K extends `${infer N extends Namespace}.${infer M}`
  ? M extends keyof English[N]
    ? English[N][M]
    : never
  : never;

/** The names between braces in a message: "{who} asked" → "who". */
type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;
type Names<V> = V extends string ? Placeholders<V> : V extends Plural ? Placeholders<V[keyof V]> | "count" : never;
type Params<K extends Key> = { [P in Names<Value<K>>]: P extends "count" ? number : string | number };
/** No argument for a message without placeholders; every placeholder for one with them. */
type Args<K extends Key> = [Names<Value<K>>] extends [never] ? [] : [params: Params<K>];

/** A dictionary with English's shape: every namespace and key, plain strings where English has a
 *  string, plural forms where it has them. */
export type Dictionary = {
  [N in Namespace]: { [M in keyof English[N]]: English[N][M] extends string ? string : Plural };
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, "pt-BR": ptBR };

/** A dictionary's messages by their whole key, "namespace.name". */
const byKey = (dictionary: Dictionary) =>
  new Map<string, string | Plural>(
    Object.entries(dictionary).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([name, value]): [string, string | Plural] => [`${namespace}.${name}`, value]),
    ),
  );
const ENGLISH = byKey(en);

/** The first language in `preferred` the app speaks: any Portuguese is Brazilian, anything it
 *  doesn't speak falls through to the next, and English when none match. The same rule as Rust's
 *  (src-tauri/src/i18n.rs). */
export function resolveLocale(language: Language | undefined, preferred: readonly string[]): Locale {
  if (language === "en" || language === "pt-BR") return language;
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split(/[-_]/u)[0];
    if (primary === "pt") return "pt-BR";
    if (primary === "en") return "en";
  }
  return "en";
}

export type T = {
  <K extends Key>(key: K, ...args: Args<K>): string;
  locale: Locale;
  /** 1,234 or 1.234. */
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** An estimate in minutes: under a minute, whole minutes, then five-minute steps past an hour. */
  duration: (minutes: number) => string;
  /** How long ago, in words: "3m ago", "há 3 min", "yesterday", "now". */
  ago: (time: number, now?: number) => string;
  /** How long since, compactly, for a list's corner: "3m", "3 min", "2d", "2 d". */
  since: (time: number, now?: number) => string;
  /** A time of day, as the person's clock shows it: "3:00 PM", "15:00". */
  clock: (date: Date) => string;
  /** A day of the week, 0 for Sunday. */
  weekday: (day: number, style: "short" | "long") => string;
  /** "a, b and c", "a, b e c". */
  list: (items: string[], type?: "conjunction" | "disjunction") => string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

export function translator(locale: Locale): T {
  const dictionary = byKey(DICTIONARIES[locale]);
  const rules = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });

  // English stands in for anything missing, so a slip shows words, not a key.
  const lookup = (key: string): string | Plural => dictionary.get(key) ?? ENGLISH.get(key) ?? key;

  const fill = (text: string, params: Record<string, string | number>) =>
    text.replaceAll(/\{(\w+)\}/gu, (match, name: string) => {
      const value = params[name];
      return value === undefined ? match : typeof value === "number" ? numbers.format(value) : value;
    });

  const words = (key: string, params: Record<string, string | number> = {}) => {
    const value = lookup(key);
    if (typeof value === "string") return fill(value, params);
    const count = Number(params.count ?? 0);
    const forms: Partial<Record<Intl.LDMLPluralRule, string>> = value;
    const form = (count === 0 ? value.zero : undefined) ?? forms[rules.select(count)] ?? value.other;
    return fill(form, params);
  };
  const t: T = Object.assign(words, {
    locale,
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      options ? new Intl.NumberFormat(locale, options).format(value) : numbers.format(value),
    duration: (minutes: number) => {
      const parts = durationParts(minutes);
      if (!parts) return t("common.underMinute");
      if (!parts.hours) return t("common.aboutMinutes", { minutes: parts.minutes });
      return parts.minutes ? t("common.aboutHoursMinutes", parts) : t("common.aboutHours", { hours: parts.hours });
    },
    ago: (time: number, now = Date.now()) => {
      const ms = Math.max(0, now - time);
      const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
        ms < MINUTE
          ? [0, "second"]
          : ms < HOUR
            ? [Math.floor(ms / MINUTE), "minute"]
            : ms < DAY
              ? [Math.floor(ms / HOUR), "hour"]
              : ms < MONTH
                ? [Math.floor(ms / DAY), "day"]
                : [Math.floor(ms / MONTH), "month"];
      // Narrow Portuguese abbreviates with a period ("há 3 min."), which reads as the end of a
      // sentence in the middle of one.
      return relative.format(-value, unit).replace(/\.$/u, "");
    },
    since: (time: number, now = Date.now()) => {
      const ms = Math.max(0, now - time);
      if (ms < MINUTE) return t("common.now");
      if (ms < HOUR) return t("common.sinceMinutes", { count: Math.floor(ms / MINUTE) });
      if (ms < DAY) return t("common.sinceHours", { count: Math.floor(ms / HOUR) });
      if (ms < MONTH) return t("common.sinceDays", { count: Math.floor(ms / DAY) });
      return t("common.sinceMonths", { count: Math.floor(ms / MONTH) });
    },
    clock: (date: Date) => clock.format(date),
    weekday: (day: number, style: "short" | "long") =>
      new Intl.DateTimeFormat(locale, { weekday: style }).format(new Date(2024, 0, 7 + day)),
    list: (items: string[], type: "conjunction" | "disjunction" = "conjunction") =>
      new Intl.ListFormat(locale, { type }).format(items),
  });
  return t;
}

// MARK: The language in use

const KEY = "language";
const listeners = new Set<() => void>();
let language: Language = remembered();
let current = translator(resolveLocale(language, systemLanguages()));
document.documentElement.lang = current.locale;

function systemLanguages(): readonly string[] {
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
}

function remembered(): Language {
  try {
    const value = localStorage.getItem(KEY);
    return LANGUAGES.find((l) => l === value) ?? "system";
  } catch {
    return "system";
  }
}

/** Uses the language picked in Settings ("system" follows the Mac). Every page calls it when the
 *  settings arrive or change; the pick is remembered, so the next window opens in it at once. */
export function setLanguage(next: Language | undefined) {
  language = next ?? "system";
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // Picked up from the settings next time.
  }
  const locale = resolveLocale(language, systemLanguages());
  if (locale === current.locale) return;
  current = translator(locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

// The Mac's languages changing reaches the web view as this.
window.addEventListener("languagechange", () => {
  setLanguage(language);
});

/** The words in the language in use, for code outside components (an error made in a callback). */
export const i18n = () => current;

/** The words in the language in use; a component re-renders when it changes. */
export function useT(): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}
