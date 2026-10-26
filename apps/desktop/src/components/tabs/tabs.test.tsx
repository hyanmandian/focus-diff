import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/tabs/tabs";

describe("Tabs", () => {
  it("shows the chosen tab's panel", async () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">The description</TabsContent>
        <TabsContent value="diff">The changes</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tabpanel").textContent).toBe("The description");
    await userEvent.click(screen.getByRole("tab", { name: "Diff" }));
    expect(screen.getByRole("tab", { name: "Diff" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("The changes");
  });

  it("can stand vertically", () => {
    render(
      <Tabs defaultValue="a" orientation="vertical" data-testid="tabs">
        <TabsList>
          <TabsTrigger value="a">General</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByTestId("tabs").dataset.orientation).toBe("vertical");
  });
});
