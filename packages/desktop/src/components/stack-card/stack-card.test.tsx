import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { StackCard } from "@/components/stack-card/stack-card";
import type { StackPull } from "@/utils/stack/stack";

const pull = (number: number, over: Partial<StackPull> = {}): StackPull => ({
  id: `PR_${number}`,
  number,
  title: `Pull request ${number}`,
  author: { login: "ana" },
  decision: "REVIEW_REQUIRED",
  isDraft: false,
  ...over,
});

describe("StackCard", () => {
  it("lists the stack from the bottom, marks this one, and goes to another on a click", async () => {
    const onPick = vi.fn<(pull: StackPull) => void>();
    const pulls = [pull(1, { decision: "APPROVED" }), pull(2), pull(3, { isDraft: true, decision: null })];
    render(<StackCard stack={{ pulls, at: 1 }} onPick={onPick} />);
    expect(screen.getByRole("heading", { name: /Stack/u }).textContent).toContain("2 of 3 in the stack");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "#1 Pull request 1Approved",
      "#2 Pull request 2To review",
      "#3 Pull request 3Draft",
    ]);
    expect(items[1]!.querySelector("[aria-current='page']")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /Pull request 3/u }));
    expect(onPick).toHaveBeenCalledWith(pulls[2]);
  });
});
