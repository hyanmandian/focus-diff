import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Skeleton } from "@/components/skeleton/skeleton";

describe("Skeleton", () => {
  it("takes the shape of what's loading", () => {
    render(<Skeleton data-testid="shape" className="h-4 w-20" />);
    expect(screen.getByTestId("shape").className).toContain("w-20");
  });
});
