import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Input } from "@/components/input/input";

describe("Input", () => {
  it("takes what's typed", async () => {
    render(<Input aria-label="Token" type="password" />);
    const field = screen.getByLabelText<HTMLInputElement>("Token");
    await userEvent.type(field, "ghp_123");
    expect(field.value).toBe("ghp_123");
    expect(field.type).toBe("password");
  });
});
