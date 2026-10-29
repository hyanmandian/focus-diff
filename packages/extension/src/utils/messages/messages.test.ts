import { describe, expect, it } from "vitest";

import config from "../../../wxt.config";
import { COMMANDS } from "./messages";

describe("COMMANDS", () => {
  it("names every keyboard shortcut the manifest declares, in its order", async () => {
    const manifest = await (typeof config.manifest === "function"
      ? config.manifest({ browser: "chrome", manifestVersion: 3, mode: "production", command: "build" })
      : config.manifest);
    expect(Object.keys(manifest?.commands ?? {})).toEqual([...COMMANDS]);
  });
});
