// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canTransition, keepOutOfTransitions, removeTransitionStyle, withTransition, type Piece } from "./transition";

const ACTIVE = "data-focus-diff-filtering";
let reducedMotion = false;
let visibility: DocumentVisibilityState = "visible";
let animate = vi.spyOn(document.documentElement, "animate");
const cancelled = new Set<Animation>();

const viewTransition = ({ fail = false } = {}) => {
  let finish = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const start = vi.fn<(update: () => void) => { ready: Promise<void>; finished: Promise<void> }>((update) => {
    update();
    return {
      ready: fail ? Promise.reject(new Error("skipped")) : Promise.resolve(),
      finished,
    };
  });
  Object.assign(document, { startViewTransition: start });
  return { start, finish };
};

const piece = (key: string, top: number, height = 100): Piece => {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: top, width: 10, height });
  return { key, element };
};

beforeEach(() => {
  reducedMotion = false;
  visibility = "visible";
  cancelled.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("innerHeight", 800);
  animate = vi.spyOn(document.documentElement, "animate").mockImplementation(() => {
    const animation = new Animation();
    vi.spyOn(animation, "cancel").mockImplementation(() => {
      cancelled.add(animation);
    });
    return animation;
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
  removeTransitionStyle();
  vi.unstubAllGlobals();
});

describe("keepOutOfTransitions", () => {
  it("names the panel so page transitions leave it out", () => {
    const host = document.createElement("div");
    keepOutOfTransitions(host);
    expect(host.style.getPropertyValue("view-transition-name")).toBe("focus-diff-panel");
  });
});

describe("canTransition", () => {
  it("needs view transitions, a tab on screen, and a reader who doesn't ask for less motion", () => {
    expect(canTransition()).toBe(false);
    viewTransition();
    expect(canTransition()).toBe(true);
    visibility = "hidden";
    expect(canTransition()).toBe(false);
    visibility = "visible";
    reducedMotion = true;
    expect(canTransition()).toBe(false);
  });
});

describe("withTransition", () => {
  it("just runs the update where it can't animate", async () => {
    const update = vi.fn<() => void>();
    await withTransition(update, () => []);
    expect(update).toHaveBeenCalledOnce();
    expect(document.querySelector("#focus-diff-transition")).toBeNull();
  });

  it("animates files leaving and arriving on screen, and cleans up after itself", async () => {
    const { start, finish } = viewTransition();
    const stays = piece("stays", 0);
    const leaves = piece("leaves", 200);
    const offScreen = piece("below", 900);
    const empty = piece("empty", 100, 0);
    const arrivals = Array.from({ length: 10 }, (_, index) => piece(`new-${index}`, 300 + index));
    let current = [leaves, stays, offScreen, empty];
    const names: string[] = [];
    const running = withTransition(
      () => {
        names.push(stays.element.style.getPropertyValue("view-transition-name"));
        current = [stays, ...arrivals];
      },
      () => current,
    );
    expect(start).toHaveBeenCalledOnce();
    expect(names).toEqual([""]);
    expect(document.documentElement.hasAttribute(ACTIVE)).toBe(true);
    expect(document.querySelector("#focus-diff-transition")?.textContent).toContain("::view-transition");
    expect(stays.element.style.getPropertyValue("view-transition-class")).toBe("focus-diff-file");
    expect(offScreen.element.style.getPropertyValue("view-transition-name")).toBe("");

    await Promise.resolve();
    await Promise.resolve();
    const timings = animate.mock.calls.map(([, options]) => (typeof options === "object" ? options : {}));
    const pseudo = timings.map(({ pseudoElement }) => pseudoElement);
    expect(pseudo[0]).toMatch(/^::view-transition-old\(focus-diff-\d+-1\)$/u);
    expect(pseudo.slice(1)).toHaveLength(10);
    for (const name of pseudo.slice(1)) expect(name).toMatch(/^::view-transition-new\(/u);
    const delays = timings.slice(1).map(({ delay }) => delay);
    expect(delays[0]).toBe(120);
    expect(delays[9]).toBe(120 + 8 * 45);

    finish();
    await running;
    expect(cancelled.size).toBe(11);
    expect(stays.element.style.getPropertyValue("view-transition-name")).toBe("");
    expect(document.documentElement.hasAttribute(ACTIVE)).toBe(false);
  });

  it("keeps the update when the transition is skipped, and leaves names the site has changed since", async () => {
    viewTransition({ fail: true });
    const file = piece("a", 0);
    const update = vi.fn<() => void>();
    const running = withTransition(update, () => [file]);
    file.element.style.setProperty("view-transition-name", "site");
    await running;
    expect(update).toHaveBeenCalledOnce();
    expect(file.element.style.getPropertyValue("view-transition-name")).toBe("site");
  });

  it("lets a newer change keep the page marked while it runs", async () => {
    const first = viewTransition();
    const earlier = withTransition(
      () => {},
      () => [],
    );
    const second = viewTransition();
    const later = withTransition(
      () => {},
      () => [],
    );
    first.finish();
    await earlier;
    expect(document.documentElement.hasAttribute(ACTIVE)).toBe(true);
    expect(document.querySelectorAll("#focus-diff-transition")).toHaveLength(1);
    second.finish();
    await later;
    expect(document.documentElement.hasAttribute(ACTIVE)).toBe(false);
  });
});

describe("removeTransitionStyle", () => {
  it("takes the style and the marker off the page", () => {
    document.head.append(Object.assign(document.createElement("style"), { id: "focus-diff-transition" }));
    document.documentElement.setAttribute(ACTIVE, "");
    removeTransitionStyle();
    expect(document.querySelector("#focus-diff-transition")).toBeNull();
    expect(document.documentElement.hasAttribute(ACTIVE)).toBe(false);
  });
});
