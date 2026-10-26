import { describe, expect, it } from "vite-plus/test";

import { PANE_META } from "@/utils/settings-panes/settings-panes";

describe("settings panes", () => {
  it("give every pane an icon on a coloured tile", () => {
    expect(Object.keys(PANE_META).toSorted()).toEqual(
      ["account", "actions", "ai", "filters", "general", "queues", "review"].toSorted(),
    );
    for (const { icon, tile } of Object.values(PANE_META)) {
      expect(icon).toBeTruthy();
      expect(tile).toMatch(/^[a-z]+$/u);
    }
  });
});
