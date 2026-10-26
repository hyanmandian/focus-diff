import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Label } from "@/components/label/label";

describe("Label", () => {
  it("names the control it's for", () => {
    render(
      <>
        <Label htmlFor="repo">Repository</Label>
        <input id="repo" />
      </>,
    );
    expect(screen.getByLabelText("Repository").id).toBe("repo");
  });
});
