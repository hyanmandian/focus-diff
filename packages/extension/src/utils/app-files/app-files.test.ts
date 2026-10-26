import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { appFileCommands, readAppFile, UNKNOWN_FILE, writeAppFile } from "./app-files";

describe("the app's files", () => {
  it("are read and written as the text the pages give", async () => {
    const commands = appFileCommands();
    expect(await commands.read_file!({ name: "config" }, { window: "settings" })).toBeNull();
    await commands.write_file!({ name: "config", contents: '{"version":1}' }, { window: "settings" });
    expect(await commands.read_file!({ name: "config" }, { window: "panel" })).toBe('{"version":1}');
    expect(await fakeBrowser.storage.local.get("file.config")).toEqual({ "file.config": '{"version":1}' });
    await writeAppFile("pace", "{}");
    expect(await readAppFile("pace")).toBe("{}");
  });

  it("are only the app's own", async () => {
    const commands = appFileCommands();
    expect(() => commands.read_file!({ name: "auth" }, { window: "settings" })).toThrow(UNKNOWN_FILE);
    await expect(commands.write_file!({ name: "../x", contents: "" }, { window: "settings" })).rejects.toThrow(
      UNKNOWN_FILE,
    );
  });
});
