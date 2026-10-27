import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "../fake-platform/fake-platform";
import { confirmRemove } from "./confirm";

describe("asking before removing", () => {
  it("asks natively, with Remove as the button, and answers what was chosen", async () => {
    const asked: unknown[] = [];
    mockCommands((cmd, args) => {
      asked.push({ cmd, args });
      return false;
    });
    await expect(confirmRemove("Remove the “Frontend” filter?")).resolves.toBe(false);
    expect(asked).toEqual([
      {
        cmd: "confirm",
        args: { title: "Remove the “Frontend” filter?", message: "This can't be undone.", ok: "Remove" },
      },
    ]);
  });
});
