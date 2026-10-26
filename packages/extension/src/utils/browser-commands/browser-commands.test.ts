import { describe, expect, it } from "vitest";

import { browserCommands } from "./browser-commands";

const from = { window: "review-1" };

describe("what a browser has no part of", () => {
  const commands = browserCommands();

  it("offers no update: the store updates the extension", () => {
    expect(commands.update_offered!({}, from)).toBeNull();
    expect(commands.check_update!({}, from)).toBeNull();
    expect(() => commands.install_update!({}, from)).toThrow("Your browser updates Focus Diff from its extension store");
  });

  it("has no AI tools, as a Mac with none installed", () => {
    expect(commands.ai_statuses!({}, from)).toEqual([]);
    expect(commands.ai_models!({ provider: "claude" }, from)).toEqual([]);
    expect(commands.ai_prepare!({}, from)).toBeNull();
    expect(commands.ai_cancel!({ run: "a" }, from)).toBeNull();
    expect(() => commands.ai_ask!({}, from)).toThrow("Asking the AI needs Focus Diff for Mac");
  });

  it("stops an action at a command, saying why", () => {
    expect(() => commands.run_action!({ action: "a", step: 0 }, from)).toThrow(
      "Commands can't run in a browser: this step needs Focus Diff for Mac",
    );
  });

  it("does nothing for the desktop's windows and menu bar", () => {
    for (const name of ["spare_ready", "menu_state", "hide_panel", "quit", "log"]) {
      expect(commands[name]!({}, from)).toBeNull();
    }
  });
});
