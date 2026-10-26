import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Badge } from "./badge";

describe("Badge", () => {
  it("shows its text", () => {
    render(<Badge variant="secondary">3 new</Badge>);
    expect(screen.getByText("3 new").tagName).toBe("SPAN");
  });

  it("can be drawn as another element", () => {
    render(<Badge render={<strong />}>Draft</Badge>);
    expect(screen.getByText("Draft").tagName).toBe("STRONG");
  });
});
