// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BreakdownRow } from "@/components/breakdown/breakdown";
import type { Totals } from "@/components/stats/stats";

import { createPanel, type PanelActions } from "./panel";

const resized: (() => void)[] = [];

class FakeResizeObserver {
  constructor(callback: () => void) {
    resized.push(callback);
  }

  observe() {}

  disconnect() {}
}

let narrow = false;
const narrowChanged: (() => void)[] = [];

const TOTALS: Totals = {
  visible: 3,
  total: 5,
  additions: 1200,
  deletions: 40,
  pending: 0,
  minutes: 30,
  viewed: 1,
  minutesLeft: 20,
};

const ROWS: BreakdownRow[] = [{ id: "frontend", name: "Frontend", ...TOTALS }];

const OPTIONS = [
  { id: "all", name: "All", count: 5 },
  { id: "frontend", name: "Frontend", count: 3 },
];

const mount = ({ floating }: { floating?: boolean } = {}) => {
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  root.append(container);
  const controller = new AbortController();
  const actions = {
    onToggle: vi.fn<PanelActions["onToggle"]>(),
    onSettings: vi.fn<PanelActions["onSettings"]>(),
    onComment: vi.fn<PanelActions["onComment"]>(),
    onNextFile: vi.fn<PanelActions["onNextFile"]>(),
    onUpdateSeen: vi.fn<PanelActions["onUpdateSeen"]>(),
  };
  const panel = createPanel({ root, container, host, signal: controller.signal, floating }, actions);
  const find = (selector: string) => root.querySelector<HTMLElement>(selector)!;
  const status = () => find('[role="status"]').textContent;
  const escape = () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  };
  return { panel, host, root, container, controller, actions, find, status, escape };
};

const scrollPadding = () => document.documentElement.style.getPropertyValue("scroll-padding-bottom");

describe("createPanel", () => {
  beforeEach(() => {
    resized.length = 0;
    narrow = false;
    narrowChanged.length = 0;
    document.documentElement.style.removeProperty("scroll-padding-bottom");
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query.includes("reduce") || (query.includes("max-width") && narrow);
      },
      addEventListener: (_type: string, listener: () => void) => {
        narrowChanged.push(listener);
      },
    }));
  });

  it("starts hidden, and keeps room at the bottom of the page while it shows", () => {
    const { panel, host, find, controller } = mount();
    expect(host.style.display).toBe("none");
    Object.defineProperty(find(".panel"), "offsetHeight", { value: 40 });
    panel.setVisible(true);
    expect(host.style.display).toBe("");
    expect(scrollPadding()).toBe("72px");
    panel.setVisible(true);
    for (const callback of resized) callback();
    expect(scrollPadding()).toBe("72px");
    panel.setVisible(false);
    expect(host.style.display).toBe("none");
    expect(scrollPadding()).toBe("");
    panel.setVisible(true);
    controller.abort();
    expect(scrollPadding()).toBe("");
  });

  it("lays out in a page without keeping room for itself", () => {
    const { panel, host } = mount({ floating: false });
    expect(host.hasAttribute("data-inline")).toBe(true);
    panel.setVisible(true);
    expect(scrollPadding()).toBe("");
  });

  it("goes compact on a small screen, and back", () => {
    narrow = true;
    const { panel, host } = mount();
    expect(host.hasAttribute("data-compact")).toBe(true);
    narrow = false;
    for (const listener of narrowChanged) listener();
    expect(host.hasAttribute("data-compact")).toBe(false);
    panel.setCompact(false);
    expect(host.hasAttribute("data-compact")).toBe(false);
    panel.setCompact(true);
    expect(host.hasAttribute("data-compact")).toBe(true);
  });

  it("turns settings into a call to set up filters until there are some to choose from", () => {
    const { panel, find, actions } = mount();
    const settings = find(".settings");
    const toggle = find(".breakdown-toggle");
    panel.renderOptions(OPTIONS.slice(0, 1), ["all"]);
    expect(settings.textContent).toBe("Set up filters");
    expect(settings.classList.contains("labelled")).toBe(true);
    expect(settings.hasAttribute("aria-label")).toBe(false);
    expect(toggle.hidden).toBe(true);
    panel.renderOptions(OPTIONS, ["all"]);
    expect(settings.textContent).toBe("");
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(settings.getAttribute("aria-label")).toBe("Focus Diff settings");
    expect(settings.dataset.tip).toBe("Focus Diff settings");
    expect(toggle.hidden).toBe(false);
    settings.dataset.tip = "kept";
    panel.renderOptions(OPTIONS, ["frontend"]);
    expect(settings.dataset.tip).toBe("kept");
    toggle.click();
    expect(find(".breakdown").hidden).toBe(false);
    panel.renderOptions(OPTIONS.slice(0, 1), ["all"]);
    expect(settings.dataset.tip).toBeUndefined();
    expect(find(".breakdown").hidden).toBe(true);
    settings.click();
    expect(actions.onSettings).toHaveBeenCalledOnce();
    find('.option[data-id="all"]').click();
    expect(actions.onToggle).toHaveBeenCalledWith("all");
  });

  it("goes to the next file, and shows what's left", () => {
    const { panel, find, actions } = mount();
    panel.renderNextFile({ left: 2 });
    find(".next-file").click();
    expect(actions.onNextFile).toHaveBeenCalledOnce();
    expect(find(".next-file").getAttribute("aria-label")).toBe("Next file to review, 2 left");
  });

  it("shows the numbers and reads out a summary", () => {
    const { panel, find, status } = mount();
    panel.renderStats(TOTALS);
    expect(find(".files").dataset.tip).toBe("2 files left to review");
    panel.announce({ ...TOTALS, name: "Frontend" });
    expect(status()).toBe("Frontend: 3 of 5 files, 1,200 lines added, 40 removed. About 30 min left to review.");
    panel.announce({ ...TOTALS, pending: 1, minutes: 0.5, name: "All" });
    expect(status()).toBe(
      "All: 3 of 5 files, 1,200 lines added, 40 removed. About <1 min left to review. 1 of them hasn’t loaded yet, so line counts are partial.",
    );
    panel.announceText("Somewhere else");
    expect(status()).toBe("Somewhere else");
  });

  it("says every file is reviewed when it celebrates", () => {
    const { panel, status } = mount();
    panel.celebrate("Frontend");
    expect(status()).toBe("Every file in Frontend is reviewed.");
  });

  it("points to a release's notes until they're seen", () => {
    const { panel, find, actions } = mount();
    panel.showUpdate("1.3.0");
    expect(find(".update").hidden).toBe(false);
    find(".update-dismiss").click();
    expect(actions.onUpdateSeen).toHaveBeenCalledOnce();
    panel.showUpdate(null);
    expect(find(".update").hidden).toBe(true);
  });

  it("styles itself with a theme, and reads its accent from it", () => {
    const { panel, root } = mount();
    const theme = root.querySelector("style[data-focus-diff-theme]")!;
    expect(panel.accent()).toBe("currentColor");
    panel.setTheme(":host { --fd-accent: red; }");
    expect(theme.textContent).toBe(":host { --fd-accent: red; }");
    panel.setTheme(":host { --fd-accent: red; }");
    expect(theme.textContent).toBe(":host { --fd-accent: red; }");
    expect(panel.accent()).toBe("red");
  });

  it("keeps one popover open at a time", () => {
    const { panel, find } = mount();
    panel.renderOptions(OPTIONS, ["all"]);
    panel.renderConversations({ list: [{ path: "a.ts", line: 1, state: "waiting" }], current: 1 });
    panel.renderBreakdown(() => ROWS, ["all"]);
    find(".breakdown-toggle").click();
    expect(find(".breakdown").hidden).toBe(false);
    find(".comments").click();
    expect(find(".conversations").hidden).toBe(false);
    expect(find(".breakdown").hidden).toBe(true);
    find(".breakdown-toggle").click();
    expect(find(".conversations").hidden).toBe(true);
    panel.setVisible(true);
    panel.setVisible(false);
    expect(find(".breakdown").hidden).toBe(true);
  });

  it("closes one thing at a time with Escape: the tooltip, the breakdown, then the conversations", () => {
    const { panel, find, root, escape, actions } = mount();
    panel.renderOptions(OPTIONS, ["all"]);
    panel.renderBreakdown(() => ROWS, ["all"]);
    find(".breakdown-toggle").click();
    find(".info").click();
    const tip = find(".tip");
    expect(tip.hidden).toBe(false);
    panel.renderConversations({ list: [{ path: "a.ts", line: 1, state: "waiting" }], current: 1 });
    panel.renderNextFile({ left: 0 });
    escape();
    expect(tip.hidden).toBe(true);
    expect(find(".breakdown").hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(find(".breakdown").hidden).toBe(false);
    escape();
    expect(find(".breakdown").hidden).toBe(true);
    find(".comments").click();
    expect(actions.onComment).not.toHaveBeenCalled();
    escape();
    expect(find(".conversations").hidden).toBe(false);
    find(".step").focus();
    expect(root.activeElement).toBe(find(".step"));
    escape();
    expect(find(".conversations").hidden).toBe(true);
    escape();
  });

  it("closes the breakdown on a press outside the bar", () => {
    const { panel, find, host } = mount();
    panel.renderOptions(OPTIONS, ["all"]);
    find(".breakdown-toggle").click();
    find(".panel").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    expect(find(".breakdown").hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(find(".breakdown").hidden).toBe(true);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(host.isConnected).toBe(true);
  });
});
