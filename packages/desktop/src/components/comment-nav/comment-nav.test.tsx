import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommentNav, type CommentStop } from "@/components/comment-nav/comment-nav";
import { TooltipProvider } from "@/components/tooltip/tooltip";

const STOPS: CommentStop[] = [
  { path: "src/cart.ts", line: 3, kind: "ai" },
  { path: "src/cart.ts", line: 9, kind: "pending" },
  { path: "src/deep/promo.ts", line: 12, kind: "conversation" },
];

/** The window's side: where it is, stepping round and round, as review.tsx does. */
function Stepping({ stops, from = -1 }: { stops: CommentStop[]; from?: number }) {
  const [stop, setStop] = useState(from);
  return (
    <CommentNav
      stops={stops}
      stop={stop}
      onStep={(by) => {
        setStop((s) => (s + by + stops.length) % stops.length);
      }}
    />
  );
}
const show = (stops: CommentStop[], from?: number) =>
  render(
    <TooltipProvider>
      <Stepping stops={stops} from={from} />
    </TooltipProvider>,
  );
const button = (name: string) => screen.getByRole("button", { name });

describe("CommentNav", () => {
  it("opens on the first comment, says which and what it is, and steps both ways", async () => {
    show(STOPS);
    await userEvent.click(button("Comments, 3 comments"));
    const card = await screen.findByRole("dialog", { name: "Comments" });
    expect(card.textContent).toContain("cart.ts:3");
    expect(card.textContent).toContain("AI comment");
    expect(screen.getByLabelText("Comment 1 of 3").textContent).toBe("1/3");
    await userEvent.click(button("Next comment"));
    expect(card.textContent).toContain("Your pending comment");
    await userEvent.click(button("Next comment"));
    // The file's name, its path in the title.
    expect(screen.getByTitle("src/deep/promo.ts").textContent).toBe("promo.ts:12");
    expect(card.textContent).toContain("Open conversation");
    await userEvent.click(button("Previous comment"));
    expect(screen.getByLabelText("Comment 2 of 3")).toBeTruthy();
  });

  it("opens where it already is, without stepping", async () => {
    const onStep = vi.fn<(by: 1 | -1) => void>();
    render(
      <TooltipProvider>
        <CommentNav stops={STOPS} stop={1} onStep={onStep} />
      </TooltipProvider>,
    );
    await userEvent.click(button("Comments, 3 comments"));
    expect(await screen.findByLabelText("Comment 2 of 3")).toBeTruthy();
    expect(onStep).not.toHaveBeenCalled();
    // Its button closes it again.
    await userEvent.click(button("Comments, 3 comments"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("stays in place without comments, and doesn't open", async () => {
    show([]);
    const toggle = button("Comments, No open comments");
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.textContent).toBe("0");
    await userEvent.click(toggle);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
