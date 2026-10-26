import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Textarea } from "@/components/textarea/textarea";

describe("Textarea", () => {
  it("takes several lines", async () => {
    render(<Textarea aria-label="Comment" />);
    const field = screen.getByLabelText<HTMLTextAreaElement>("Comment");
    await userEvent.type(field, "Looks good{Enter}Ship it");
    expect(field.value).toBe("Looks good\nShip it");
  });
});
