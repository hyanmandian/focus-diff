import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";

function Menu({ onArchive }: { onArchive: () => void }) {
  const [wrap, setWrap] = useState(false);
  const [sort, setSort] = useState("newest");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>View</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel inset>Diff</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
            Wrap Lines
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          <DropdownMenuRadioItem value="newest">Newest First</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="oldest">Oldest First</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuItem variant="destructive" onClick={onArchive}>
          Archive
          <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Copy</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Copy Link</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe("DropdownMenu", () => {
  it("opens from its trigger and runs the item chosen", async () => {
    const onArchive = vi.fn<() => void>();
    render(<Menu onArchive={onArchive} />);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText("Diff")).toBeTruthy();
    expect(screen.getByText("⌘E")).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: /Archive/u }));
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("checks a checkbox item and picks one of a radio group", async () => {
    render(<Menu onArchive={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    const wrap = await screen.findByRole("menuitemcheckbox", { name: "Wrap Lines" });
    expect(wrap.getAttribute("aria-checked")).toBe("false");
    // Checking an item leaves the menu open.
    await userEvent.click(wrap);
    expect(wrap.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Newest First" }).getAttribute("aria-checked")).toBe("true");
    const oldest = screen.getByRole("menuitemradio", { name: "Oldest First" });
    await userEvent.click(oldest);
    expect(oldest.getAttribute("aria-checked")).toBe("true");
  });

  it("opens a submenu", async () => {
    render(<Menu onArchive={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "View" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy" }));
    expect(await screen.findByRole("menuitem", { name: "Copy Link" })).toBeTruthy();
  });

  it("has a portal of its own for custom content", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuPortal>
          <p>Elsewhere</p>
        </DropdownMenuPortal>
      </DropdownMenu>,
    );
    expect(screen.getByText("Elsewhere")).toBeTruthy();
  });
});
