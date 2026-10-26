import { describe, expect, it } from "vitest";
import { en } from "@/locales/en/index";
import { ptBR } from "@/locales/pt-BR/index";
import { resolveLocale, translator, type Plural } from "@/utils/i18n/i18n";

type Messages = Record<string, Record<string, string | Plural>>;

/** The placeholders a message uses, in every form, sorted. */
const placeholders = (value: string | Plural | undefined) =>
  [...new Set([...JSON.stringify(value ?? "").matchAll(/\{(\w+)\}/g)].map(([, name]) => name))].sort().join(",");

describe("translations", () => {
  const english = en as unknown as Messages;
  const portuguese = ptBR as unknown as Messages;

  it("cover every English message, with the same placeholders", () => {
    expect(Object.keys(portuguese).sort()).toEqual(Object.keys(english).sort());
    for (const [namespace, messages] of Object.entries(english)) {
      expect(Object.keys(portuguese[namespace] ?? {}).sort(), namespace).toEqual(Object.keys(messages).sort());
      for (const [name, value] of Object.entries(messages)) {
        const translated = portuguese[namespace]?.[name];
        expect(placeholders(translated), `${namespace}.${name}`).toBe(placeholders(value));
        // A plural in one is a plural in the other, with the forms every language needs.
        expect(typeof translated, `${namespace}.${name}`).toBe(typeof value);
        if (typeof translated === "object") expect(translated.one && translated.other, `${namespace}.${name}`).toBeTruthy();
      }
    }
  });

  it("leave no message empty", () => {
    for (const dictionary of [english, portuguese])
      for (const [namespace, messages] of Object.entries(dictionary))
        for (const [name, value] of Object.entries(messages)) expect(JSON.stringify(value).replace(/"(one|other|zero|many)":/g, ""), `${namespace}.${name}`).not.toMatch(/""/);
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
