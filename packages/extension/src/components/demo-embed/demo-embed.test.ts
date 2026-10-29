// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { DemoOptions } from "@/components/demo/demo";
import { SAMPLE_PULL_REQUEST } from "@/utils/demo-sample/demo-sample";

const createDemo = vi.hoisted(() => vi.fn<(target: HTMLElement, pullRequest: unknown, options: DemoOptions) => void>());
vi.mock("@/components/demo/demo", () => ({ createDemo }));

describe("demo-embed", () => {
  it("puts the sample pull request on every marked element, its settings going to the element's link", async () => {
    const assign = vi.fn<(url: string) => void>();
    vi.stubGlobal("location", { assign });
    document.body.innerHTML = `
      <div data-focus-diff-demo data-settings="https://example.com/settings"></div>
      <div data-focus-diff-demo></div>
      <div></div>`;
    await import("./demo-embed");
    expect(createDemo).toHaveBeenCalledTimes(2);
    const [first, second] = createDemo.mock.calls;
    expect(first![1]).toBe(SAMPLE_PULL_REQUEST);
    expect(first![2].theme).toContain("--fd-");
    first![2].onSettings();
    expect(assign).toHaveBeenLastCalledWith("https://example.com/settings");
    second![2].onSettings();
    expect(assign).toHaveBeenLastCalledWith("https://github.com/hyanmandian/focus-diff#readme");
  });
});
