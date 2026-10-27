import type { Learned } from "@focus-diff/core/estimate";
// @vitest-environment happy-dom
import type { Config } from "@focus-diff/desktop/utils/config";
import { describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  learn,
  loadConfig,
  loadLearned,
  readConfig,
  readLearned,
  selectionsItem,
  watchConfig,
  watchLearned,
} from "./bar-settings";

const FILTER = { id: "web", name: "Web", include: "\\.tsx?$", exclude: "", repos: [] };

describe("the bar's settings", () => {
  it("moves single selections from earlier versions to lists", async () => {
    await fakeBrowser.storage.local.set({
      active: { "acme/web": "frontend", "acme/api": "all", "acme/docs": ["docs", "all"] },
    });
    await selectionsItem.migrate();
    expect(await selectionsItem.getValue()).toEqual({
      "acme/web": ["frontend"],
      "acme/api": [],
      "acme/docs": ["docs"],
    });
  });

  it("reads the filters, theme and language of the setup the app keeps", async () => {
    expect((await loadConfig()).filters.length).toBeGreaterThan(0);
    await fakeBrowser.storage.local.set({
      "file.config": JSON.stringify({ filters: [FILTER], theme: "dark", language: "pt-BR" }),
    });
    const config = await loadConfig();
    expect(config.filters).toEqual([FILTER]);
    expect([config.theme, config.language]).toEqual(["dark", "pt-BR"]);
    expect(readConfig("{").theme).toBe("system");
  });

  it("follows the setup as it's saved", async () => {
    const changed = vi.fn<(config: Config) => void>();
    watchConfig(changed);
    await fakeBrowser.storage.local.set({ "file.config": JSON.stringify({ filters: [] }) });
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledWith(expect.objectContaining({ filters: [] }));
    });
  });

  it("learns the pace on top of what's kept, and follows what others learn", async () => {
    expect((await loadLearned()).all.files).toBe(0);
    const heard = vi.fn<(learned: Learned) => void>();
    watchLearned(heard);
    const learned = await learn([{ path: "src/a.ts", expected: 2, actual: 4 }]);
    expect(learned.all.files).toBe(1);
    const { "file.pace": kept } = await fakeBrowser.storage.local.get("file.pace");
    expect(readLearned(typeof kept === "string" ? kept : null)).toEqual(learned);
    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledWith(learned);
    });
    expect(readLearned("not json").all.files).toBe(0);
  });
});
