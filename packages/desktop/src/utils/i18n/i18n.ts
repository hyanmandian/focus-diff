import { durationParts } from "@focus-diff/core/duration";
import { useSyncExternalStore } from "react";

import { en } from "@/locales/en/index";
import { ptBR } from "@/locales/pt-BR/index";

export const LOCALES = ["en", "pt-BR"] as const;
export type Locale = (typeof LOCALES)[number];
export type Language = "system" | Locale;
export const LANGUAGES = ["system", ...LOCALES] as const satisfies readonly Language[];

export type Plural = { zero?: string; one: string; other: string; many?: string };

type English = typeof en;
type Namespace = Extract<keyof English, string>;
export type Key = { [N in Namespace]: `${N}.${keyof English[N] & string}` }[Namespace];
type Value<K extends Key> = K extends `${infer N extends Namespace}.${infer M}`
  ? M extends keyof English[N]
    ? English[N][M]
    : never
  : never;

type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;
type Names<V> = V extends string ? Placeholders<V> : V extends Plural ? Placeholders<V[keyof V]> | "count" : never;
type Params<K extends Key> = { [P in Names<Value<K>>]: P extends "count" ? number : string | number };
type Args<K extends Key> = [Names<Value<K>>] extends [never] ? [] : [params: Params<K>];

export type Dictionary = {
  [N in Namespace]: { [M in keyof English[N]]: English[N][M] extends string ? string : Plural };
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, "pt-BR": ptBR };

const byKey = (dictionary: Dictionary) =>
  new Map<string, string | Plural>(
    Object.entries(dictionary).flatMap(([namespace, messages]) =>
      Object.entries(messages).map(([name, value]): [string, string | Plural] => [`${namespace}.${name}`, value]),
    ),
  );
const ENGLISH = byKey(en);

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
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  duration: (minutes: number) => string;
  ago: (time: number, now?: number) => string;
  since: (time: number, now?: number) => string;
  clock: (date: Date) => string;
  weekday: (day: number, style: "short" | "long") => string;
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

export function setLanguage(next: Language | undefined) {
  language = next ?? "system";
  try {
    localStorage.setItem(KEY, language);
  } catch {}
  const locale = resolveLocale(language, systemLanguages());
  if (locale === current.locale) return;
  current = translator(locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

window.addEventListener("languagechange", () => {
  setLanguage(language);
});

export const i18n = () => current;

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
