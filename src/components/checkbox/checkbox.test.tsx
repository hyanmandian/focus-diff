import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Checkbox } from "@/components/checkbox/checkbox";

describe("Checkbox", () => {
  it("checks and unchecks when clicked", async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Viewed" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Viewed" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything());
    await userEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");
  });
});
