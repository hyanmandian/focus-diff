import { describe, expect, it } from "vite-plus/test";

import { confirmRemove } from "@/utils/confirm/confirm";
import { mockCommands } from "@/utils/fake-platform/fake-platform";

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
