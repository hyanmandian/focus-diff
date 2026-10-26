import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Progress, ProgressLabel, ProgressValue } from "@/components/progress/progress";

describe("Progress", () => {
  it("shows how far along it is, with its label and value", () => {
    render(
      <Progress value={40}>
        <ProgressLabel>Files viewed</ProgressLabel>
        <ProgressValue />
      </Progress>,
    );
    const bar = screen.getByRole("progressbar", { name: "Files viewed" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("40%")).toBeTruthy();
  });
});
