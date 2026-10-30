import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { message, uiLanguage } from "./i18n";

const extension = vi.hoisted(() => ({ present: true }));

vi.mock("wxt/browser", async (original: () => Promise<{ browser: unknown }>) => {
  const { browser } = await original();
  return {
    get browser() {
      return extension.present ? browser : undefined;
    },
  };
});

afterEach(() => {
  extension.present = true;
  vi.unstubAllGlobals();
});

describe("message", () => {
  it("reads a message by a key known only at runtime, or gives the key back", () => {
    expect(message("filterAll")).toBe("All");
    expect(message("noSuchMessage")).toBe("noSuchMessage");
  });
});

describe("uiLanguage", () => {
  it("is the browser's language", () => {
    expect(uiLanguage()).toBe("en-US");
  });

  it("is the page's language where the extension API isn't there", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "" });
    expect(uiLanguage()).toBe("pt-BR");
    Object.assign(fakeBrowser.i18n, { getUILanguage: undefined });
    expect(uiLanguage()).toBe("pt-BR");
    extension.present = false;
    expect(uiLanguage()).toBe("pt-BR");
  });

  it("is US English when nothing says otherwise", () => {
    vi.stubGlobal("navigator", { language: "" });
    extension.present = false;
    expect(uiLanguage()).toBe("en-US");
  });
});
