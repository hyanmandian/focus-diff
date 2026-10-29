import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Kbd } from "@/components/kbd/kbd";

describe("Kbd", () => {
  it("writes a shortcut as macOS does", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
  });
});
