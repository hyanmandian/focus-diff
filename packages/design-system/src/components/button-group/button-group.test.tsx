import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "../button/button";
import { ButtonGroup } from "./button-group";

describe("ButtonGroup", () => {
  it("groups related buttons", () => {
    render(
      <ButtonGroup aria-label="Checks">
        <Button>Show Log</Button>
        <Button>Re-run</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole("group", { name: "Checks" });
    expect(group.querySelectorAll("button")).toHaveLength(2);
  });
});
