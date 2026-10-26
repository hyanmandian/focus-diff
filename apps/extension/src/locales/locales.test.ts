import { describe, expect, it } from "vitest";

import en from "./en.json";
import ptBR from "./pt_BR.json";

type Messages = Record<string, string | Record<string, string>>;

const placeholders = (value: string | Record<string, string>) =>
  [...JSON.stringify(value).matchAll(/\$(\d)/gu)]
    .map(([, index]) => Number(index))
    .toSorted((a, b) => a - b)
    .join(",");

describe("translations", () => {
  it("cover every English message with the same placeholders", () => {
    const reference = en as Messages;
    const translated = ptBR as Messages;
    expect(Object.keys(translated).toSorted()).toEqual(Object.keys(reference).toSorted());
    for (const [key, value] of Object.entries(reference)) {
      expect({ key, placeholders: placeholders(translated[key] ?? "") }).toEqual({
        key,
        placeholders: placeholders(value),
      });
    }
  });
});
