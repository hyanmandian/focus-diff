// @vitest-environment happy-dom
import type { Learned } from "@focus-diff/core/estimate";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BarProps } from "@/utils/review-controller/review-controller";

import { createBarView } from "./bar";

const file = (path: string, additions: number) => ({
  path,
  previousPath: null,
  status: "modified" as const,
  additions,
  deletions: 0,
  patch: "",
});

const props = (overrides: Partial<BarProps> = {}): BarProps => ({
  files: [file("src/a.ts", 40), file("docs/b.md", 5)],
  filters: [{ id: "code", name: "Code", include: "\\.ts$", exclude: "", repos: [] }],
  chosen: [],
  shown: { files: 2, viewed: 0, additions: 45, deletions: 0, minutes: 4, minutesLeft: 4 },
  next: { left: 2 },
  isViewed: () => false,
  minutesOf: () => 2,
  learned: null as Learned | null,
  onToggle: vi.fn<(id: string) => void>(),
  onNextFile: vi.fn<() => void>(),
  ...overrides,
});

afterEach(() => {
  document.body.replaceChildren();
});

const setUp = () => {
  const host = document.createElement("focus-diff-bar");
  const container = document.createElement("div");
  host.append(container);
  document.body.append(host);
  return { host, container, view: createBarView(container, host) };
};

describe("the bar", () => {
  it("draws the app's filter bar, and passes the reader's picks on", async () => {
    const { container, view } = setUp();
    const shown = props();
    act(() => {
      view.render(shown);
    });
    const bar = within(container).getByRole("group", { name: "Review one part" });
    await userEvent.click(within(bar).getByRole("button", { name: /^Code/u }));
    expect(shown.onToggle).toHaveBeenCalledWith("code");
    await userEvent.click(within(bar).getByRole("button", { name: "Next file to review, 2 left" }));
    expect(shown.onNextFile).toHaveBeenCalledOnce();
    act(() => {
      view.render(null);
    });
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("draws its popups inside its own container, where its styles are", async () => {
    const { container, view } = setUp();
    act(() => {
      view.render(props());
    });
    await userEvent.click(within(container).getByRole("button", { name: "Breakdown by filter" }));
    expect(within(container).getByRole("dialog")).toBeTruthy();
  });

  it("wears the Mac's look, light or dark, and says which language it speaks", () => {
    const { host, container, view } = setUp();
    expect(host.dataset.platform).toBe("macos");
    expect(container.hasAttribute("data-focus-diff-bar")).toBe(true);
    view.setDark(true);
    expect(container.classList.contains("dark")).toBe(true);
    expect(host.style.colorScheme).toBe("dark");
    view.setDark(false);
    expect(container.classList.contains("dark")).toBe(false);
    expect(host.style.colorScheme).toBe("light");
    view.setLocale("pt-BR");
    expect(host.lang).toBe("pt-BR");
  });
});
