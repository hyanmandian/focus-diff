import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { PullState } from "@/components/pull-state/pull-state";

describe("PullState", () => {
  it.each([
    ["OPEN", false, "Open"],
    ["OPEN", true, "Draft"],
    ["CLOSED", false, "Closed"],
    ["MERGED", false, "Merged"],
  ] as const)("says a %s pull request (draft: %s) is %s", (state, isDraft, text) => {
    render(<PullState details={{ state, isDraft }} />);
    expect(screen.getByText(text).getAttribute("data-state")).toBe(text.toLowerCase());
  });
});
