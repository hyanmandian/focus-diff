import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { followConfig, language, tr } from "./words";

describe("the background's words", () => {
  it("follow the browser's language until Settings picks one", () => {
    followConfig(null);
    expect(tr("Hello", "Olá")).toBe("Hello");
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    expect(tr("Hello", "Olá")).toBe("Olá");
    followConfig(JSON.stringify({ language: "en" }));
    expect(language()).toBe("en");
    followConfig(JSON.stringify({ language: "system" }));
    expect(language()).toBe("pt-BR");
  });

  it("take a broken setup as the browser's", () => {
    followConfig(JSON.stringify({ language: "pt-BR" }));
    expect(language()).toBe("pt-BR");
    followConfig("{");
    expect(language()).toBe("en");
  });
});
