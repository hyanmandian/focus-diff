import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";

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
    expect(split.dataset.variant).toBe("outline");
    expect(split.dataset.pill).toBe("split");
    expect(split.className).toContain("aria-pressed:bg-transparent");
    expect(document.querySelector("[data-slot=toggle-group] > span[aria-hidden]")).not.toBeNull();
  });

  it("slides for a group it's told the value of, and not for several chosen at once", () => {
    const group = (value: string[]) => (
      <ToggleGroup variant="outline" value={value} multiple={value.length > 1}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>
    );
    const { rerender } = render(group(["a"]));
    expect(screen.getByRole("button", { name: "A" }).dataset.pill).toBe("a");
    rerender(group(["a", "b"]));
    expect(screen.getByRole("button", { name: "A" }).dataset.pill).toBeUndefined();
    expect(document.querySelector("[data-slot=toggle-group] > span[aria-hidden]")).toBeNull();
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
