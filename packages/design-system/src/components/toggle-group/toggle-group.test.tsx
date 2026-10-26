import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

describe("ToggleGroup", () => {
  it("is a segmented control: one segment chosen at a time", async () => {
    const onValueChange = vi.fn<() => void>();
    render(
      <ToggleGroup variant="outline" size="sm" defaultValue={["unified"]} onValueChange={onValueChange}>
        <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
        <ToggleGroupItem value="split">Split</ToggleGroupItem>
      </ToggleGroup>,
    );
    const unified = screen.getByRole("button", { name: "Unified" });
    const split = screen.getByRole("button", { name: "Split" });
    expect(unified.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(split);
    expect(split.getAttribute("aria-pressed")).toBe("true");
    expect(unified.getAttribute("aria-pressed")).toBe("false");
    expect(onValueChange).toHaveBeenLastCalledWith(["split"], expect.anything());
    // The group's look is its segments' look.
    expect(split.dataset.variant).toBe("outline");
  });

  it("lets an item keep its own look when the group has none", () => {
    render(
      <ToggleGroup orientation="vertical" spacing={0}>
        <ToggleGroupItem value="a" variant="outline" size="lg">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    const item = screen.getByRole("button", { name: "A" });
    expect(item.dataset.variant).toBe("outline");
    expect(item.dataset.size).toBe("lg");
  });

  it("works outside a group, at the default look", () => {
    render(<ToggleGroupItem value="alone">Alone</ToggleGroupItem>);
    expect(screen.getByRole("button", { name: "Alone" }).dataset.variant).toBe("default");
  });
});
