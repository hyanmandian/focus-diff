import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Switch } from "./switch";

describe("Switch", () => {
  it("turns on and off", async () => {
    render(<Switch size="sm" aria-label="Notifications" />);
    const toggle = screen.getByRole("switch", { name: "Notifications" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("starts on when asked", () => {
    render(<Switch defaultChecked aria-label="Sounds" />);
    expect(screen.getByRole("switch", { name: "Sounds" }).getAttribute("aria-checked")).toBe("true");
  });
});
