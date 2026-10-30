import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { WhatsNew } from "@/components/whats-new/whats-new";
import { mockCommands } from "@/utils/fake-platform/fake-platform";

describe("WhatsNew", () => {
  it("lists what's new and fixed, links to GitHub, and closes", async () => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockCommands((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<WhatsNew open onOpenChange={onOpenChange} version="99.0.0" />);
    const dialog = screen.getByRole("dialog", { name: "What's new in Focus Diff 99.0.0" });
    expect(within(dialog).getAllByRole("heading", { level: 3 }).length).toBeLessThanOrEqual(5);
    expect(within(dialog).getAllByText(/^(New|Fixed)$/u).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: /All releases on GitHub/u }));
    expect(calls.at(-1)).toEqual({
      cmd: "open_url",
      args: { url: "https://github.com/hyanmandian/focus-diff/releases/tag/desktop-v99.0.0" },
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says when there's nothing to show", () => {
    render(<WhatsNew open onOpenChange={() => {}} version="0.0.1" />);
    expect(screen.getByText("Nothing new to show for this version.")).toBeTruthy();
  });
});
