import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebI18n } from "./i18n-web";

vi.mock("@/locales/pt_BR.json", () => ({
  default: {
    filterAll: "Todos",
    panelFilesLeft: { 0: "Nenhum arquivo", 1: "$1 arquivo", n: "$1 arquivos" },
    onlyOne: { 1: "um" },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("createWebI18n", () => {
  it("fills placeholders and picks plural forms like the extension", () => {
    const { t } = createWebI18n("en-US");
    expect(t("filterAll")).toBe("All");
    expect(t("panelFilesLeft", 1, ["1"])).toBe("1 file left to review");
    expect(t("panelFilesLeft", 9, ["9"])).toBe("9 files left to review");
    expect(t("panelFilesLeft", 0, ["0"])).toBe("0 files left to review");
    expect(t("panelJumpedToComment", ["2", "3", "docs/a.md"])).toBe("Conversation 2 of 3, in docs/a.md.");
  });

  it("fills $1 with the count when there's no list, and missing substitutions with nothing", () => {
    const { t } = createWebI18n("en");
    expect(t("panelFilesLeft", 4)).toBe("4 files left to review");
    expect(t("panelJumpedToComment", ["2"])).toBe("Conversation 2 of , in .");
    expect(t("panelJumpedToComment", [{}, 3, "a.md"])).toBe("Conversation  of 3, in a.md.");
  });

  it("speaks Brazilian Portuguese, and English for languages it lacks", () => {
    expect(createWebI18n("pt-BR").t("filterAll")).toBe("Todos");
    expect(createWebI18n("PT").t("filterAll")).toBe("Todos");
    expect(createWebI18n("de-DE").t("filterAll")).toBe("All");
  });

  it("uses a language's own zero form, English for messages it lacks, and nothing for messages nobody has", () => {
    const { t } = createWebI18n("pt-BR");
    expect(t("panelFilesLeft", 0)).toBe("Nenhum arquivo");
    expect(t("panelFilesLeft", 1)).toBe("1 arquivo");
    expect(t("panelFilesLeft", 2)).toBe("2 arquivos");
    expect(t("onlyOne", 2)).toBe("");
    expect(t("panelJumpedToComment", ["1", "2", "a.md"])).toBe("Conversation 1 of 2, in a.md.");
    expect(t("noSuchMessage")).toBe("");
  });
});

describe("i18n", () => {
  it("speaks the page's language", async () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    const { i18n } = await import("./i18n-web");
    expect(i18n.t("filterAll")).toBe("Todos");
  });

  it("speaks English where there's no navigator", async () => {
    // oxlint-disable-next-line unicorn/no-useless-undefined -- stubbing the global as missing takes the value.
    vi.stubGlobal("navigator", undefined);
    const { i18n } = await import("./i18n-web");
    expect(i18n.t("filterAll")).toBe("All");
  });
});
