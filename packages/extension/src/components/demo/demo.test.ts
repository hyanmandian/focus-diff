// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_PULL_REQUEST, type DemoPullRequest } from "@/utils/demo-sample/demo-sample";

import { createDemo } from "./demo";

import theme from "@/components/github-theme/github-theme.css?inline";

const mount = (pullRequest: DemoPullRequest = SAMPLE_PULL_REQUEST, target = document.createElement("div")) => {
  document.body.append(target);
  const onSettings = vi.fn<() => void>();
  const { setTheme } = createDemo(target, structuredClone(pullRequest), { onSettings, theme });
  const root = target.shadowRoot!;
  const bar = root.querySelector(".demo-bar")!.shadowRoot!;
  const shown = () => root.querySelectorAll(".demo-file:not([data-out])").length;
  const option = (id: string) => bar.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
  const status = () => bar.querySelector('[role="status"]')?.textContent;
  const at = () => root.querySelector('.demo-file[aria-current="true"] .demo-path')?.textContent;
  const click = (selector: string) => {
    bar.querySelector<HTMLElement>(selector)!.click();
  };
  return { target, root, bar, shown, option, onSettings, setTheme, status, at, click };
};

/** Two files, one with a conversation; a docs filter; a filter that can't match (its pattern doesn't compile). */
const SMALL: DemoPullRequest = {
  filters: [
    { id: "docs", name: "recipeStackFrontend", include: "\\.md$", exclude: "" },
    { id: "code", name: "recipeStackBackend", include: "\\.ts$", exclude: "" },
    { id: "broken", name: "recipeAreaName", include: "(", exclude: "" },
  ],
  files: [
    { path: "a.md", additions: 1, deletions: 0 },
    { path: "b.ts", additions: 2, deletions: 1, conversations: [{ line: 3, state: "waiting" }] },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("createDemo", () => {
  it("filters the sample pull request with the real bar", () => {
    const { shown, option } = mount();
    expect(shown()).toBe(12);
    option("frontend").click();
    expect(shown()).toBe(3);
    option("backend").click();
    expect(shown()).toBe(6);
    option("all").click();
    expect(shown()).toBe(12);
  });

  it("counts a file off when it is marked as viewed", () => {
    const { root, bar } = mount();
    const left = () => bar.querySelector(".files-count")?.textContent;
    expect(left()).toBe("9");
    root.querySelector<HTMLButtonElement>('.demo-viewed[aria-pressed="false"]')!.click();
    expect(left()).toBe("8");
  });

  it("hands the settings button to the page", () => {
    const { bar, onSettings } = mount();
    bar.querySelector<HTMLButtonElement>(".settings")!.click();
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("goes from file to file left to review, then to the next filter with some", () => {
    const { root, option, click, at, status } = mount(SMALL);
    click(".next-file");
    expect(at()).toBe("a.md");
    expect(status()).toBe("a.md. 2 files left to review.");
    click(".next-file");
    expect(at()).toBe("b.ts");
    click(".next-file");
    // Round again to the first.
    expect(at()).toBe("a.md");
    option("docs").click();
    root.querySelector<HTMLButtonElement>(".demo-file:not([data-out]) .demo-viewed")!.click();
    click(".next-file");
    expect(at()).toBe("b.ts");
  });

  it("stays put with every file viewed and no filter left with work", () => {
    const { root, option, click, at } = mount(SMALL);
    for (const button of root.querySelectorAll<HTMLButtonElement>(".demo-viewed")) button.click();
    click(".next-file");
    expect(at()).toBeUndefined();
    option("docs").click();
    click(".next-file");
    expect(at()).toBeUndefined();
  });

  it("keeps files outside the filter from being marked, and says why", () => {
    const { root, option } = mount(SMALL);
    option("docs").click();
    const outside = root.querySelectorAll(".demo-file")[1]!;
    const toggle = outside.querySelector<HTMLButtonElement>(".demo-viewed")!;
    expect(toggle.dataset.tip).toBe("Not in Frontend");
    expect(outside.querySelector(".visually-hidden")?.textContent).toBe("Not in Frontend");
    toggle.click();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("steps through the conversations, and does nothing where there are none", () => {
    const { root, option, click, at, status } = mount(SMALL);
    click(".conversation-steps .step:nth-child(2)");
    expect(at()).toBe("b.ts");
    expect(status()).toBe("Conversation 1 of 1, in b.ts.");
    expect(root.querySelector(".demo-talk")?.hasAttribute("data-current")).toBe(true);
    option("docs").click();
    click(".conversation-steps .step:nth-child(2)");
    expect(status()).not.toContain("Conversation");
  });

  it("scrolls to a file at once for readers who prefer reduced motion", () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn<() => void>() }));
    const { click } = mount(SMALL);
    click(".next-file");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", behavior: "instant" });
  });

  it("hides the files' tooltip on Escape", () => {
    vi.useFakeTimers();
    const { root, option } = mount(SMALL);
    option("docs").click();
    const toggle = root.querySelectorAll<HTMLElement>(".demo-viewed")[1]!;
    toggle.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(400);
    const tip = root.querySelector<HTMLElement>(".tip")!;
    expect(tip.hidden).toBe(false);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(tip.hidden).toBe(false);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tip.hidden).toBe(true);
  });

  it("goes compact where it's too narrow for the whole bar", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width: 600 }));
    const { bar } = mount();
    expect(bar.host.hasAttribute("data-compact")).toBe(true);
  });

  it("restyles, reuses its shadow root, and ignores the update notice it never shows", () => {
    const first = mount();
    first.setTheme(":host { --fd-accent: red; }");
    expect([...first.root.adoptedStyleSheets].some((sheet) => sheet.cssRules[0]?.cssText.includes("red"))).toBe(true);
    first.click(".update-dismiss");
    const second = mount(SAMPLE_PULL_REQUEST, first.target);
    expect(second.root).toBe(first.root);
    expect(second.shown()).toBe(12);
  });
});
