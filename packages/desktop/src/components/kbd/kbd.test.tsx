import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Kbd, KbdGroup } from "@/components/kbd/kbd";

describe("Kbd", () => {
  it("writes a shortcut as macOS does", () => {
    render(
      <KbdGroup data-testid="group">
        <Kbd>⌥⇧J</Kbd>
        <Kbd>⌘K</Kbd>
      </KbdGroup>,
    );
    expect(screen.getByTestId("group").textContent).toBe("⌥⇧J⌘K");
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });
});
