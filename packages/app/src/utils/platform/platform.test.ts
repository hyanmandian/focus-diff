import { describe, expect, it } from "vite-plus/test";

import { fakePlatform } from "../fake-platform/fake-platform";
import { invoke, platform, setPlatform, type Args, type InvokeOptions } from "./platform";

describe("the platform", () => {
  it("is the one the entry set, and runs commands through it", async () => {
    const asked: Array<[string, Args | undefined, InvokeOptions | undefined]> = [];
    const other = {
      ...fakePlatform,
      invoke: <T>(command: string, args?: Args, options?: InvokeOptions) => {
        asked.push([command, args, options]);
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test's answer, in any shape
        return Promise.resolve("answer" as T);
      },
    };
    setPlatform(other);
    try {
      expect(platform()).toBe(other);
      await expect(invoke("refresh", { force: true }, { headers: { "x-a": "1" } })).resolves.toBe("answer");
      expect(asked).toEqual([["refresh", { force: true }, { headers: { "x-a": "1" } }]]);
    } finally {
      setPlatform(fakePlatform);
    }
  });

  it("says so when none was set", () => {
    delete window.focusDiffPlatform;
    try {
      expect(() => platform()).toThrow("No platform");
    } finally {
      setPlatform(fakePlatform);
    }
  });
});
