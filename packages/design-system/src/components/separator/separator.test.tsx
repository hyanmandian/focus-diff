import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Separator } from "./separator";

describe("Separator", () => {
  it("separates across, or up and down when asked", () => {
    render(
      <>
        <Separator />
        <Separator orientation="vertical" />
      </>,
    );
    const [across, upright] = screen.getAllByRole("separator");
    expect(across?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(upright?.getAttribute("aria-orientation")).toBe("vertical");
  });
});
