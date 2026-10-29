import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { DEFAULT_APPEARANCE } from "@/utils/appearance/appearance";
import { DEFAULT_NOTIFY, DEFAULT_POPUP } from "@/utils/inbox/inbox";
import { DEFAULT_REVIEW_TIME } from "@/utils/review-sessions/review-sessions";

import {
  configItem,
  loadAppearance,
  loadConfig,
  loadNotify,
  loadPopup,
  loadReviewTime,
  saveAppearance,
  saveConfig,
  saveNotify,
  savePopup,
  saveReviewTime,
  selectionsItem,
} from "./storage";

describe("selections", () => {
  it("moves single selections from earlier versions to lists", async () => {
    await fakeBrowser.storage.local.set({
      active: { "octo/web": "frontend", "octo/api": "all", "octo/docs": ["docs", "all"] },
    });
    await selectionsItem.migrate();
    expect(await selectionsItem.getValue()).toEqual({
      "octo/web": ["frontend"],
      "octo/api": [],
      "octo/docs": ["docs"],
    });
  });

  it("starts empty", async () => {
    expect(await selectionsItem.getValue()).toEqual({});
  });
});

describe("config", () => {
  it("normalizes what it reads and writes", async () => {
    await fakeBrowser.storage.sync.set({ config: { global: [{ name: " Docs ", include: "\\.md$" }, "junk"] } });
    const config = await loadConfig();
    expect(config.global).toEqual([{ id: config.global[0]?.id, name: "Docs", include: "\\.md$", exclude: "" }]);
    expect(typeof config.global[0]?.id).toBe("string");

    await saveConfig({ global: [{ id: "all", name: "X", include: "", exclude: "" }], repos: [] });
    const saved = await configItem.getValue();
    expect(saved.global[0]?.id).not.toBe("all");
  });

  it("is synced across devices", async () => {
    await saveConfig({ global: [], repos: [{ repo: "octo/web", filters: [] }] });
    expect(await fakeBrowser.storage.sync.get("config")).toEqual({
      config: { global: [], repos: [{ repo: "octo/web", filters: [] }] },
    });
  });
});

describe("settings", () => {
  it("reads defaults until something is saved", async () => {
    expect(await loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(await loadNotify()).toEqual(DEFAULT_NOTIFY);
    expect(await loadPopup()).toEqual(DEFAULT_POPUP);
    expect(await loadReviewTime()).toEqual(DEFAULT_REVIEW_TIME);
  });

  it("normalizes what it reads and syncs what it writes", async () => {
    await fakeBrowser.storage.sync.set({
      popup: { repos: ["octo/web", "octo/web"], teams: false, updates: true, merged: "yes", junk: 1 },
    });
    expect(await loadPopup()).toEqual({
      repos: ["octo/web"],
      excludeRepos: [],
      teams: false,
      updates: true,
      merged: false,
    });

    await savePopup({ repos: [], excludeRepos: ["octo/api"], teams: true, updates: false, merged: false });
    expect(await fakeBrowser.storage.sync.get("popup")).toEqual({
      popup: { repos: [], excludeRepos: ["octo/api"], teams: true, updates: false, merged: false },
    });

    await saveNotify({ ...DEFAULT_NOTIFY, enabled: true });
    expect(await loadNotify()).toEqual({ ...DEFAULT_NOTIFY, enabled: true });

    await saveReviewTime({ ...DEFAULT_REVIEW_TIME, enabled: true });
    expect(await loadReviewTime()).toEqual({ ...DEFAULT_REVIEW_TIME, enabled: true });

    await saveAppearance({ ...DEFAULT_APPEARANCE });
    expect(await fakeBrowser.storage.sync.get("appearance")).toEqual({ appearance: DEFAULT_APPEARANCE });
  });
});
