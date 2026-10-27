// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentScriptContext } from "wxt/utils/content-script-context";

import type { PanelActions } from "@/components/panel/panel";
import { github as provider } from "@/utils/github-provider/github-provider";

import { mountBar } from "./mount-bar";

const ui = vi.hoisted(() => ({ mounted: undefined as unknown, onMount: undefined as unknown }));
const controller = vi.hoisted(() => ({
  toggle: vi.fn<(id: string) => void>(),
  openSettings: vi.fn<() => void>(),
  comment: vi.fn<(step: 1 | -1) => void>(),
  nextUnviewed: vi.fn<() => void>(),
  dismissUpdate: vi.fn<() => void>(),
}));
const panel = vi.hoisted(() => ({ actions: undefined as PanelActions | undefined }));
const startController = vi.hoisted(() => vi.fn<() => Promise<typeof controller>>());
const keepOutOfTransitions = vi.hoisted(() => vi.fn<(host: HTMLElement) => void>());

vi.mock("wxt/utils/content-script-ui/shadow-root", () => ({
  createShadowRootUi: (_ctx: unknown, options: { onMount: (...args: HTMLElement[]) => unknown }) =>
    Promise.resolve({
      get mounted() {
        return ui.mounted;
      },
      mount: () => {
        const host = document.createElement("div");
        ui.mounted = ui.onMount === false ? undefined : options.onMount(document.createElement("div"), host, host);
      },
    }),
}));
vi.mock("@/components/panel/panel", () => ({
  createPanel: (_context: unknown, actions: PanelActions) => {
    panel.actions = actions;
    return { panel: true };
  },
}));
vi.mock(import("@/utils/review-controller/review-controller"), () => ({ startController }));
vi.mock(import("@/utils/transition/transition"), () => ({ keepOutOfTransitions }));

const ctx = new ContentScriptContext("test");

describe("mountBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.onMount = undefined;
    panel.actions = undefined;
    startController.mockResolvedValue(controller);
  });

  it("mounts the panel in the extension's language and hands its actions to the controller", async () => {
    await mountBar(ctx, provider);
    expect(keepOutOfTransitions).toHaveBeenCalledOnce();
    expect(keepOutOfTransitions.mock.calls[0]![0].lang).toBe("en-US");
    expect(startController).toHaveBeenCalledWith(ctx, { panel: true }, provider);
    const actions = panel.actions!;
    actions.onToggle("frontend");
    actions.onSettings();
    actions.onComment(-1);
    actions.onNextFile();
    actions.onUpdateSeen();
    expect(controller.toggle).toHaveBeenCalledWith("frontend");
    expect(controller.openSettings).toHaveBeenCalledOnce();
    expect(controller.comment).toHaveBeenCalledWith(-1);
    expect(controller.nextUnviewed).toHaveBeenCalledOnce();
    expect(controller.dismissUpdate).toHaveBeenCalledOnce();
  });

  it("ignores the panel's actions until the controller has started", async () => {
    startController.mockReturnValue(new Promise(() => {}));
    void mountBar(ctx, provider);
    await vi.waitFor(() => {
      expect(panel.actions).toBeDefined();
    });
    const actions = panel.actions!;
    actions.onToggle("frontend");
    actions.onSettings();
    actions.onComment(1);
    actions.onNextFile();
    actions.onUpdateSeen();
    expect(controller.toggle).not.toHaveBeenCalled();
  });

  it("starts nothing when the bar didn't mount", async () => {
    ui.onMount = false;
    await mountBar(ctx, provider);
    expect(startController).not.toHaveBeenCalled();
  });
});
