import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/tooltip/tooltip";

describe("Tooltip", () => {
  it("says what a control does when the pointer rests on it", async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Next</TooltipTrigger>
          <TooltipContent>Next pull request</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.queryByText("Next pull request")).toBeNull();
    await userEvent.hover(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Next pull request")).toBeTruthy();
  });

  it("waits about a second by default", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Back</TooltipTrigger>
          <TooltipContent>Previous pull request</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByText("Previous pull request")).toBeNull();
    expect(await screen.findByText("Previous pull request", {}, { timeout: 2000 })).toBeTruthy();
  });
});
