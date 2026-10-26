import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Mark } from "@/components/mark/mark";

describe("Mark", () => {
  it("draws the app's mark, hidden from screen readers", () => {
    const { container } = render(<Mark className="size-6" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toBe("size-6");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // The brackets and the two lines, in the text's colour.
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.querySelectorAll("path")).toHaveLength(1);
    expect(svg?.querySelectorAll("rect")).toHaveLength(2);
  });
});
