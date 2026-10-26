import { describe, expect, it } from "vite-plus/test";

import { i18n } from "../i18n/i18n";
import { firstName, interval } from "./copy";

describe("first names", () => {
  it("calls someone by the first word of their name", () => {
    expect(firstName({ login: "ana-dev", name: "  Ana Maria Souza " }, i18n())).toBe("Ana");
  });

  it("falls back to the login when there's no name, or it's blank", () => {
    expect(firstName({ login: "ana-dev", name: null }, i18n())).toBe("ana-dev");
    expect(firstName({ login: "ana-dev", name: "   " }, i18n())).toBe("ana-dev");
  });

  it("says someone when there's nobody to name", () => {
    expect(firstName(null, i18n())).toBe("Someone");
  });
});

describe("refresh intervals", () => {
  it("counts seconds under two minutes and minutes from there", () => {
    expect(interval(30, i18n())).toBe("30 seconds");
    expect(interval(119, i18n())).toBe("119 seconds");
    expect(interval(180, i18n())).toBe("3 minutes");
  });
});
