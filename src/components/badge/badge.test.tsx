import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Badge } from "@/components/badge/badge";

describe("Badge", () => {
  it("shows its text", () => {
    render(<Badge variant="secondary">3 new</Badge>);
    expect(screen.getByText("3 new").tagName).toBe("SPAN");
  });

  it("can be drawn as a link", () => {
    render(<Badge render={<a href="https://github.com/org/repo/labels/bug" />}>bug</Badge>);
    expect(screen.getByRole("link", { name: "bug" }).getAttribute("href")).toBe(
      "https://github.com/org/repo/labels/bug",
    );
  });
});
