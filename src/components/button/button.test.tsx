import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Button } from "@/components/button/button";

describe("Button", () => {
  it("does its action when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Merge</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does nothing while disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="destructive" size="xs" disabled onClick={onClick}>
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
