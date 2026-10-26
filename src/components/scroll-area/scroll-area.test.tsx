import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { ScrollArea } from "@/components/scroll-area/scroll-area";

describe("ScrollArea", () => {
  it("holds what scrolls", () => {
    render(<ScrollArea aria-label="Files">src/app.ts</ScrollArea>);
    expect(screen.getByLabelText("Files").textContent).toBe("src/app.ts");
  });
});
