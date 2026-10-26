import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Toggle } from "./toggle";

describe("Toggle", () => {
  it("is pressed and unpressed by clicks", async () => {
    render(<Toggle size="sm">Split</Toggle>);
    const button = screen.getByRole("button", { name: "Split" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});
