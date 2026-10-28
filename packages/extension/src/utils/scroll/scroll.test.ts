// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flash, scrollToCenter, scrollToTop, waitFor } from "./scroll";

let now = 0;
let frames: FrameRequestCallback[] = [];
let pageY = 0;
let reducedMotion = false;
const scrolls: ScrollToOptions[] = [];

const tick = (ms = 16) => {
  now += ms;
  const waiting = frames;
  frames = [];
  for (const frame of waiting) frame(now);
};

beforeEach(() => {
  now = 0;
  frames = [];
  pageY = 0;
  reducedMotion = false;
  scrolls.length = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.endsWith(": reduce)") ? reducedMotion : !reducedMotion,
  }));
  vi.stubGlobal("innerHeight", 800);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => pageY });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
  vi.stubGlobal("scrollTo", (options: ScrollToOptions) => {
    scrolls.push(options);
    pageY = options.top ?? pageY;
  });
});

afterEach(() => {
  dispatchEvent(new Event("wheel"));
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("waitFor", () => {
  it("resolves straight away with what's already there", async () => {
    await expect(waitFor(() => "here")).resolves.toBe("here");
  });

  it("checks every frame until the site draws it", async () => {
    let found: string | null = null;
    const waiting = waitFor(() => found);
    tick();
    found = "drawn";
    tick();
    await expect(waiting).resolves.toBe("drawn");
  });

  it("gives up with null after the timeout", async () => {
    const waiting = waitFor(() => null, 100);
    tick(50);
    tick(60);
    await expect(waiting).resolves.toBeNull();
  });
});

const placed = (top: number, height = 100) => {
  const element = document.createElement("div");
  document.body.append(element);
  const position = { top };
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: position.top - pageY, width: 10, height });
  return { element, position };
};

describe("scrollToTop", () => {
  it("does nothing for a hidden element", () => {
    const element = document.createElement("div");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a list of no boxes, as a hidden element has.
    element.getClientRects = () => [] as unknown as DOMRectList;
    scrollToTop(element, () => 0);
    expect(scrolls).toEqual([]);
  });

  it("brings the element right below the covered part, smoothly unless the reader asks for less motion", () => {
    scrollToTop(placed(1000).element, () => 60);
    expect(scrolls).toEqual([{ top: 940, behavior: "smooth" }]);
    reducedMotion = true;
    scrollToTop(placed(10).element, () => 60);
    expect(scrolls.at(-1)).toEqual({ top: 0, behavior: "auto" });
    scrollToTop(placed(9000).element, () => 0, "instant");
    expect(scrolls.at(-1)).toEqual({ top: 4200, behavior: "instant" });
  });

  it("follows the element while content drawn above pushes it down, then lets go once the page settles", () => {
    const { element, position } = placed(1000);
    scrollToTop(element, () => 0);
    tick();
    expect(scrolls).toHaveLength(1);
    position.top = 1300;
    tick();
    expect(scrolls.at(-1)).toEqual({ top: 1300, behavior: "smooth" });
    tick(700);
    position.top = 2000;
    tick();
    expect(scrolls).toHaveLength(2);
  });

  it("brings the page back when the site scrolls it away and it stays there", () => {
    const { element } = placed(1000);
    scrollToTop(element, () => 0);
    pageY = 500;
    tick();
    tick();
    tick();
    expect(scrolls).toHaveLength(1);
    tick();
    expect(scrolls.at(-1)).toEqual({ top: 1000, behavior: "smooth" });
  });

  it("lets go as soon as the reader scrolls", () => {
    const { element, position } = placed(1000);
    scrollToTop(element, () => 0);
    dispatchEvent(new Event("keydown"));
    position.top = 1500;
    tick();
    expect(scrolls).toHaveLength(1);
    expect(frames).toEqual([]);
  });

  it("lets go of an element taken off the page, and of every element after a while", () => {
    const first = placed(1000);
    scrollToTop(first.element, () => 0);
    first.element.remove();
    tick();
    expect(frames).toEqual([]);

    const second = placed(1000);
    scrollToTop(second.element, () => 0);
    for (let step = 0; step < 20; step++) {
      second.position.top += 100;
      tick(300);
    }
    expect(frames).toEqual([]);
  });

  it("lets go of the previous element when going somewhere else", () => {
    const first = placed(1000);
    scrollToTop(first.element, () => 0);
    scrollToTop(placed(2000).element, () => 0);
    first.position.top = 3000;
    tick();
    expect(scrolls.map(({ top }) => top)).toEqual([1000, 2000]);
  });
});

describe("scrollToCenter", () => {
  it("puts the element in the middle of the screen, clear of the covered part", () => {
    scrollToCenter(placed(1000, 200).element, () => 60);
    expect(scrolls.at(-1)).toEqual({ top: 700, behavior: "smooth" });
    scrollToCenter(placed(2000, 780).element, () => 60);
    expect(scrolls.at(-1)?.top).toBe(1940);
  });
});

describe("flash", () => {
  const shadows = (keyframes: Keyframe[] | PropertyIndexedKeyframes | null) =>
    Array.isArray(keyframes) ? keyframes.map(({ boxShadow }) => boxShadow) : [];
  const animated = () => {
    const element = document.createElement("div");
    const previous = element.animate([], 1000);
    previous.id = "focus-diff-flash";
    const site = element.animate([], 1000);
    const cancels = [previous, site].map((animation) => vi.spyOn(animation, "cancel").mockImplementation(() => {}));
    const animate = vi.spyOn(element, "animate");
    return { element, cancels, animate };
  };

  it("lights a ring that grows in, replacing an earlier one and leaving the site's animations alone", () => {
    const { element, cancels, animate } = animated();
    flash(element, "red");
    expect(cancels[0]).toHaveBeenCalledOnce();
    expect(cancels[1]).not.toHaveBeenCalled();
    expect(animate.mock.results[0]?.value).toHaveProperty("id", "focus-diff-flash");
    const [keyframes, timing] = animate.mock.calls[0]!;
    expect(timing).toEqual({ duration: 2000, easing: "ease-out" });
    expect(shadows(keyframes)).toEqual([
      "0 0 0 2px color-mix(in srgb, red 0%, transparent), 0 0 0 0px color-mix(in srgb, red 0%, transparent)",
      "0 0 0 2px color-mix(in srgb, red 100%, transparent), 0 0 0 8px color-mix(in srgb, red 25%, transparent)",
      "0 0 0 2px color-mix(in srgb, red 100%, transparent), 0 0 0 6px color-mix(in srgb, red 25%, transparent)",
      "0 0 0 2px color-mix(in srgb, red 0%, transparent), 0 0 0 0px color-mix(in srgb, red 0%, transparent)",
    ]);
  });

  it("with reduced motion, the ring doesn't grow", () => {
    reducedMotion = true;
    const { element, animate } = animated();
    flash(element, "blue");
    const [keyframes] = animate.mock.calls[0]!;
    const list = shadows(keyframes);
    expect(list).toHaveLength(4);
    for (const shadow of list) expect(shadow).toContain("0 0 0 6px");
  });
});
