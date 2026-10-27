// @vitest-environment happy-dom
import { i18n } from "@focus-diff/desktop/utils/i18n";
import { describe, expect, it, vi } from "vitest";

import { applyLanguage } from "./bar-language";

describe("the bar's language", () => {
  it("is the one picked in Settings, leaving GitHub's page and storage as they were", () => {
    document.documentElement.lang = "en";
    localStorage.removeItem("language");
    applyLanguage("pt-BR");
    expect(i18n().locale).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("language")).toBeNull();
    localStorage.setItem("language", "github's own");
    applyLanguage("en");
    expect(i18n().locale).toBe("en");
    expect(localStorage.getItem("language")).toBe("github's own");
  });

  it("works where the page's storage is off", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("off");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("off");
    });
    applyLanguage("pt-BR");
    expect(i18n().locale).toBe("pt-BR");
    applyLanguage("system");
  });
});
