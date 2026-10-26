import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { tabKeys } from "./keys";

function tabs(onClick = vi.fn<(name: string) => void>()) {
  render(
    <>
      <button type="button">Before</button>
      <div role="tablist" tabIndex={-1} onKeyDown={tabKeys}>
        {["One", "Two", "Off", "Three"].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            disabled={name === "Off"}
            onClick={() => {
              onClick(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </>,
  );
  return onClick;
}

describe("moving between tabs with the keyboard", () => {
  it("moves with the arrows, choosing the tab it lands on and skipping disabled ones", async () => {
    const chosen = tabs();
    screen.getByRole("tab", { name: "Two" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }));
    expect(chosen).toHaveBeenLastCalledWith("Three");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Two" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }));
  });

  it("wraps around the ends, and Home and End go to them", async () => {
    tabs();
    screen.getByRole("tab", { name: "One" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "One" }));
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" }));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "One" }));
  });

  it("leaves other keys alone", async () => {
    const chosen = tabs();
    screen.getByRole("tab", { name: "One" }).focus();
    await userEvent.keyboard("a");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "One" }));
    expect(chosen).not.toHaveBeenCalled();
  });

  it("does nothing when focus isn't on a tab", () => {
    const chosen = tabs();
    const list = screen.getByRole("tablist");
    screen.getByRole("button", { name: "Before" }).focus();
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Before" }));
    expect(chosen).not.toHaveBeenCalled();
  });
});
