import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog/dialog";

function Sheet({ closeBox = false, footerClose = false }: { closeBox?: boolean; footerClose?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Rename…</DialogTrigger>
      <DialogContent showCloseButton={closeBox}>
        <DialogHeader>
          <DialogTitle>Rename the action</DialogTitle>
          <DialogDescription>Its name shows in the toolbar.</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton={footerClose}>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("opens from its trigger, named by its title, and Cancel closes it", async () => {
    render(<Sheet />);
    await userEvent.click(screen.getByRole("button", { name: "Rename…" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename the action" });
    expect(dialog.textContent).toContain("Its name shows in the toolbar.");
    // No close box unless asked for.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("can have a close box", async () => {
    render(<Sheet closeBox />);
    await userEvent.click(screen.getByRole("button", { name: "Rename…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("can have a Close button in its footer", async () => {
    render(<Sheet footerClose />);
    await userEvent.click(screen.getByRole("button", { name: "Rename…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
