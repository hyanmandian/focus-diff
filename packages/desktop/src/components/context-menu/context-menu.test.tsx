import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/context-menu/context-menu";
import { DropdownMenuItem } from "@/components/dropdown-menu/dropdown-menu";

describe("ContextMenu", () => {
  it("opens on a secondary click and runs the item chosen", async () => {
    const onCopy = vi.fn<() => void>();
    render(
      <ContextMenu>
        <ContextMenuTrigger>src/app.ts</ContextMenuTrigger>
        <ContextMenuContent>
          <DropdownMenuItem onClick={onCopy}>Copy Path</DropdownMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("src/app.ts"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy Path" }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});
