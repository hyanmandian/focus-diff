import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

describe("Collapsible", () => {
  it("shows its content when opened and hides it when closed", async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Older commits</CollapsibleTrigger>
        <CollapsibleContent className="pl-2">Fix the build</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = screen.getByRole("button", { name: "Older commits" });
    expect(screen.queryByText("Fix the build")).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByText("Fix the build").className).toContain("pl-2");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves out a class given as a function", () => {
    render(
      <Collapsible defaultOpen>
        <CollapsibleContent className={() => "from-state"}>Body</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.getByText("Body").className).not.toContain("from-state");
  });
});
