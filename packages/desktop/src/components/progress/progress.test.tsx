import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Progress } from "@/components/progress/progress";

describe("Progress", () => {
  it("shows how far along it is", () => {
    render(<Progress value={40} aria-label="Files viewed" />);
    const bar = screen.getByRole("progressbar", { name: "Files viewed" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
  });
});
