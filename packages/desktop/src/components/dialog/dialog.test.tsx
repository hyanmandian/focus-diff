import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { Button } from "@/components/button/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/dialog/dialog";

describe("Dialog", () => {
  it("is named by its title, and Cancel closes it", async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Rename the action</DialogTitle>
          <DialogDescription>Its name shows in the toolbar.</DialogDescription>
          <DialogFooter>
            <DialogPrimitive.Close render={<Button variant="outline" />}>Cancel</DialogPrimitive.Close>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Rename the action" });
    expect(dialog.textContent).toContain("Its name shows in the toolbar.");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
