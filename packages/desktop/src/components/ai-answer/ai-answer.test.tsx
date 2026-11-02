import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { AiAnswer, AiInline } from "@/components/ai-answer/ai-answer";

describe("AiAnswer", () => {
  it("draws paragraphs and points, joining a paragraph's lines", () => {
    const { container } = render(
      <AiAnswer
        text={"The change is safe.\nIt only renames.\n\n- First point\n* Second point\n• Third\nAfter the list"}
      />,
    );
    const paragraphs = [...container.querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toEqual(["The change is safe. It only renames.", "After the list"]);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "First point",
      "Second point",
      "Third",
    ]);
  });

  it("starts a new list after a blank line", () => {
    render(<AiAnswer text={"- One\n\n- Two"} />);
    expect(screen.getAllByRole("list")).toHaveLength(2);
  });

  it("shows `code` and **bold** as such, and never as HTML", () => {
    const { container } = render(<AiAnswer text={"Call `run()` **now**, not <b>later</b>; `` and **** stay."} />);
    expect(container.querySelector("code")?.textContent).toBe("run()");
    expect(container.querySelector("strong")?.textContent).toBe("now");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>later</b>");
    expect(container.textContent).toContain("`` and **** stay.");
  });

  it("leaves bare backticks and asterisks as they are", () => {
    const { container } = render(<AiAnswer text={"``\n\n****"} />);
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["``", "****"]);
    expect(container.querySelector("code, strong")).toBeNull();
  });

  it("starts with code without mixing up what it shows", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<AiInline text="`a` then **b**" />);
    expect(container.innerHTML).toBe(
      '<code class="rounded bg-muted px-1 font-mono text-[0.92em]">a</code> then <strong>b</strong>',
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
