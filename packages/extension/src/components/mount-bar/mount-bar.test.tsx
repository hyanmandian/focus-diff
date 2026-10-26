// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentScriptContext } from "wxt/utils/content-script-context";

import { github as provider } from "@/utils/github-provider/github-provider";
import type { Provider } from "@/utils/provider/provider";
import type { BarView, Controller } from "@/utils/review-controller/review-controller";

import { mountBar } from "./mount-bar";

const ui = vi.hoisted(() => ({ mounted: undefined as unknown, skip: false }));
const startController = vi.hoisted(() =>
  vi.fn<(ctx: ContentScriptContext, view: BarView, provider: Provider) => Promise<Controller>>(),
);
const keepOutOfTransitions = vi.hoisted(() => vi.fn<(host: HTMLElement) => void>());
const view = vi.hoisted((): BarView => ({ render: () => {}, setDark: () => {}, setLocale: () => {} }));
const createBarView = vi.hoisted(() => vi.fn<(container: HTMLElement, host: HTMLElement) => BarView>(() => view));

vi.mock("wxt/utils/content-script-ui/shadow-root", () => ({
  createShadowRootUi: (_ctx: unknown, options: { onMount: (...args: unknown[]) => unknown }) =>
    Promise.resolve({
      get mounted() {
        return ui.mounted;
      },
      mount: () => {
        if (ui.skip) return;
        const host = document.createElement("div");
        ui.mounted = options.onMount(document.createElement("div"), null, host);
      },
    }),
}));
vi.mock(import("@/components/bar/bar"), () => ({ createBarView }));
vi.mock(import("@/utils/review-controller/review-controller"), () => ({ startController }));
vi.mock(import("@/utils/transition/transition"), () => ({ keepOutOfTransitions }));

const ctx = new ContentScriptContext("test");

describe("mountBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.mounted = undefined;
    ui.skip = false;
    startController.mockResolvedValue({ toggle: () => {}, nextUnviewed: () => {} });
  });

  it("draws the bar in its shadow root, kept out of page transitions, and starts filtering", async () => {
    await mountBar(ctx, provider);
    const [container, host] = createBarView.mock.calls[0]!;
    expect(keepOutOfTransitions).toHaveBeenCalledWith(host);
    expect(container).not.toBe(host);
    expect(startController).toHaveBeenCalledWith(ctx, view, provider);
  });

  it("starts nothing when the bar didn't mount", async () => {
    ui.skip = true;
    await mountBar(ctx, provider);
    expect(startController).not.toHaveBeenCalled();
  });
});
