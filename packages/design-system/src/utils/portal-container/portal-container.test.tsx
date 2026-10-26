import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Popover, PopoverContent, PopoverTrigger } from "../../components/popover/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/tooltip/tooltip";
import { PortalContainer } from "./portal-container";

describe("PortalContainer", () => {
  it("draws tooltips and popovers in the container given, not the page's body", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      <PortalContainer value={container}>
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger>Next</TooltipTrigger>
            <TooltipContent>Next file</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Popover>
          <PopoverTrigger>Breakdown</PopoverTrigger>
          <PopoverContent>By filter</PopoverContent>
        </Popover>
      </PortalContainer>,
    );
    await userEvent.hover(screen.getByRole("button", { name: "Next" }));
    expect(container.contains(await screen.findByText("Next file"))).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Breakdown" }));
    expect(container.contains(await screen.findByText("By filter"))).toBe(true);
    container.remove();
  });
});
