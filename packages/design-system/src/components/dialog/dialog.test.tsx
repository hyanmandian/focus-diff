import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "../button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function Sheet({
  closeBox = false,
  footerClose = false,
  closeLabel,
}: {
  closeBox?: boolean;
  footerClose?: boolean;
  closeLabel?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Rename…</DialogTrigger>
      <DialogContent showCloseButton={closeBox} closeLabel={closeLabel}>
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

  it("names its close box in the app's language", async () => {
    render(<Sheet closeBox closeLabel="Fechar" />);
    await userEvent.click(screen.getByRole("button", { name: "Rename…" }));
    expect(await screen.findByRole("button", { name: "Fechar" })).toBeTruthy();
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
