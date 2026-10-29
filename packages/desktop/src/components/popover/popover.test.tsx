import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/popover/popover";

describe("Popover", () => {
  it("opens from its trigger, named by its title", async () => {
    render(
      <Popover>
        <PopoverTrigger>Estimate</PopoverTrigger>
        <PopoverContent side="top">
          <PopoverTitle>About 12 minutes</PopoverTitle>
          <p>From your pace on files like these.</p>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("About 12 minutes")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    const popup = await screen.findByRole("dialog", { name: "About 12 minutes" });
    expect(popup.textContent).toContain("From your pace on files like these.");
  });
});
