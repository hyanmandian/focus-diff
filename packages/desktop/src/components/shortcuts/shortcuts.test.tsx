import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Shortcuts } from "@/components/shortcuts/shortcuts";

describe("Shortcuts", () => {
  it("lists the keys by group, as macOS writes them", () => {
    render(<Shortcuts open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    const files = within(dialog).getByRole("region", { name: "Files" });
    expect(within(files).getByText("Next file").nextElementSibling?.textContent).toBe("j");
    expect(within(dialog).getByText("⌘↩")).toBeTruthy();
  });

  it("closes with Done", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<Shortcuts open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows nothing while closed", () => {
    render(<Shortcuts open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
