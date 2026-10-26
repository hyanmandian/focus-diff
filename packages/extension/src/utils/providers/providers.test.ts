import { describe, expect, it } from "vitest";

import { PROVIDERS, providerNames } from "./providers";

describe("PROVIDERS", () => {
  it("lists GitHub, with the bar's theme in its colours", async () => {
    expect(PROVIDERS.map(({ id, name }) => [id, name])).toEqual([["github", "GitHub"]]);
    expect(await PROVIDERS[0]!.theme()).toContain("--fd-");
  });
});

describe("providerNames", () => {
  it("names the supported sites as a list in the reader's language", () => {
    expect(providerNames("en")).toBe("GitHub");
    expect(providerNames()).toBe("GitHub");
  });
});
