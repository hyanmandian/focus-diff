import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { en } from "@/locales/en/index";
import { ptBR } from "@/locales/pt-BR/index";
import { resolveLocale, translator, type Dictionary, type Plural } from "@/utils/i18n/i18n";

const messages = (dictionary: Dictionary) =>
  Object.entries(dictionary).flatMap(([namespace, list]) =>
    Object.entries(list).map(([name, value]): [string, string | Plural] => [`${namespace}.${name}`, value]),
  );

const placeholders = (value: string | Plural) =>
  new Set([...JSON.stringify(value).matchAll(/\{(\w+)\}/gu)].map(([, name]) => name));

const shape = (dictionary: Dictionary) =>
  Object.fromEntries(
    messages(dictionary).map(([key, value]) => [key, { kind: typeof value, placeholders: placeholders(value) }]),
  );

function fresh() {
  vi.resetModules();
  return import("@/utils/i18n/i18n");
}

const blockStorage = () =>
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("blocked");
  });

describe("translations", () => {
  it("cover every English message, with the same placeholders", () => {
    expect(shape(ptBR)).toEqual(shape(en));
  });

  it("leave no message empty", () => {
    const empty = [...messages(en), ...messages(ptBR)]
      .filter(([, value]) => (typeof value === "string" ? [value] : Object.values(value)).includes(""))
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});

describe("translator", () => {
  const t = translator("en");
  const pt = translator("pt-BR");

  it("fills placeholders and picks plural forms", () => {
    expect(t("common.files", { count: 1 })).toBe("1 file");
    expect(t("common.files", { count: 1200 })).toBe("1,200 files");
    expect(pt("common.files", { count: 1200 })).toBe("1.200 arquivos");
    expect(pt("common.githubReturned", { status: "502" })).toBe("O GitHub respondeu 502");
    expect(t("common.files", { count: 0 })).toBe("0 files");
    expect(pt("common.files", { count: 1_000_000 })).toBe("1.000.000 arquivos");
  });

  it("leaves a placeholder it isn't given as it is", () => {
    // @ts-expect-error -- a call missing its placeholder, as a slip would be
    expect(t("common.githubReturned")).toBe("GitHub returned {status}");
    // @ts-expect-error -- a plural without its count reads as none
    expect(t("common.files")).toBe("{count} files");
  });

  it("shows the key itself for a message no dictionary has", () => {
    // @ts-expect-error -- a key that doesn't exist, as a slip would make
    expect(pt("nowhere.toBeFound")).toBe("nowhere.toBeFound");
  });

  it("formats numbers, times of day, weekdays and lists", () => {
    expect(t.number(1234.5)).toBe("1,234.5");
    expect(pt.number(0.25, { style: "percent" })).toBe("25%");
    expect(t.clock(new Date(2026, 0, 1, 15, 5))).toBe("3:05 PM");
    expect(pt.clock(new Date(2026, 0, 1, 15, 5))).toBe("15:05");
    expect(t.weekday(0, "long")).toBe("Sunday");
    expect(t.weekday(1, "short")).toBe("Mon");
    expect(t.list(["a", "b", "c"])).toBe("a, b, and c");
    expect(pt.list(["a", "b"], "disjunction")).toBe("a ou b");
  });

  it("says estimates in words", () => {
    expect(t.duration(0.5)).toBe("<1 min");
    expect(t.duration(19.6)).toBe("~20 min");
    expect(t.duration(62)).toBe("~1 h");
    expect(t.duration(93)).toBe("~1 h 35 min");
  });

  it("says how long ago", () => {
    const now = Date.UTC(2026, 0, 10);
    expect(t.ago(now - 20_000, now)).toBe("now");
    expect(pt.ago(now - 20_000, now)).toBe("agora");
    expect(t.ago(now - 3 * 60_000, now)).toBe("3m ago");
    expect(pt.ago(now - 3 * 60_000, now)).toBe("há 3 min");
    expect(pt.since(now - 12 * 86_400_000, now)).toBe("12 d");
    expect(t.since(now - 5 * 3_600_000, now)).toBe("5h");
    expect(t.ago(now - 5 * 3_600_000, now)).toBe("5h ago");
    expect(t.ago(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(t.ago(now - 65 * 86_400_000, now)).toBe("2mo ago");
    expect(t.since(now - 1000, now)).toBe("now");
    expect(t.since(now - 3 * 60_000, now)).toBe("3m");
    expect(t.since(now - 65 * 86_400_000, now)).toBe("2mo");
    expect(t.ago(Date.now() + 60_000)).toBe("now");
    expect(t.since(Date.now() + 60_000)).toBe("now");
  });
});

describe("resolveLocale", () => {
  it("follows a pick, then the first language the app speaks", () => {
    expect(resolveLocale("en", ["pt-BR"])).toBe("en");
    expect(resolveLocale("system", ["pt-PT", "en-US"])).toBe("pt-BR");
    expect(resolveLocale("system", ["fr-FR", "pt-BR"])).toBe("pt-BR");
    expect(resolveLocale("system", ["fr-FR", "de"])).toBe("en");
  });
});

describe("the language in use", () => {
  it("follows the Mac's languages, and the page says which", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    const { i18n } = await fresh();
    expect(i18n().locale).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("falls back to the browser's one language when it lists none", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("pt-PT");
    const { i18n } = await fresh();
    expect(i18n().locale).toBe("pt-BR");
  });

  it("opens in the language picked last time, ignoring a pick it doesn't know", async () => {
    localStorage.setItem("language", "pt-BR");
    expect((await fresh()).i18n().locale).toBe("pt-BR");
    localStorage.setItem("language", "klingon");
    expect((await fresh()).i18n().locale).toBe("en");
  });

  it("follows the system when the pick can't be read", async () => {
    const blocked = blockStorage();
    expect((await fresh()).i18n().locale).toBe("en");
    blocked.mockRestore();
  });

  it("changes when picked, re-rendering what reads it, and remembers it", async () => {
    const { setLanguage, useT } = await fresh();
    const { result, unmount } = renderHook(() => useT());
    expect(result.current("common.now")).toBe("now");
    act(() => {
      setLanguage("pt-BR");
    });
    expect(result.current("common.now")).toBe("agora");
    expect(localStorage.getItem("language")).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    const before = result.current;
    act(() => {
      setLanguage("pt-BR");
    });
    expect(result.current).toBe(before);
    unmount();
    setLanguage(undefined);
    expect(localStorage.getItem("language")).toBe("system");
  });

  it("still changes when the pick can't be remembered", async () => {
    const { i18n, setLanguage } = await fresh();
    const blocked = blockStorage();
    setLanguage("pt-BR");
    expect(i18n().locale).toBe("pt-BR");
    blocked.mockRestore();
  });

  it("follows the Mac's languages changing", async () => {
    const { i18n } = await fresh();
    expect(i18n().locale).toBe("en");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    window.dispatchEvent(new Event("languagechange"));
    expect(i18n().locale).toBe("pt-BR");
  });
});
