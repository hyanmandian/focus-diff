import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/popover/popover";

describe("Popover", () => {
  it("opens from its trigger with a title and description", async () => {
    render(
      <Popover>
        <PopoverTrigger>Estimate</PopoverTrigger>
        <PopoverContent side="top">
          <PopoverHeader>
            <PopoverTitle>About 12 minutes</PopoverTitle>
            <PopoverDescription>From your pace on files like these.</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("About 12 minutes")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Estimate" }));
    const popup = await screen.findByRole("dialog", { name: "About 12 minutes" });
    expect(popup.textContent).toContain("From your pace on files like these.");
  });
});
