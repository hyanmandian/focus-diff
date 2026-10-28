import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";

const ITEMS = { squash: "Squash and merge", merge: "Create a merge commit", rebase: "Rebase and merge" };

describe("Select", () => {
  it("shows the value chosen and changes it from the list", async () => {
    const onValueChange = vi.fn<() => void>();
    render(
      <Select items={ITEMS} defaultValue="squash" onValueChange={onValueChange}>
        <SelectTrigger size="sm" aria-label="Merge method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="squash">{ITEMS.squash}</SelectItem>
          <SelectItem value="merge">{ITEMS.merge}</SelectItem>
          <SelectItem value="rebase">{ITEMS.rebase}</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Merge method" });
    expect(trigger.textContent).toContain("Squash and merge");
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "Rebase and merge" }));
    expect(onValueChange).toHaveBeenCalledWith("rebase", expect.anything());
    expect(trigger.textContent).toContain("Rebase and merge");
  });
});
