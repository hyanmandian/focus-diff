// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confetti } from "./confetti";

const fakeContext = () => ({
  scale: vi.fn<() => void>(),
  clearRect: vi.fn<() => void>(),
  save: vi.fn<() => void>(),
  translate: vi.fn<() => void>(),
  rotate: vi.fn<() => void>(),
  fillRect: vi.fn<() => void>(),
  restore: vi.fn<() => void>(),
  globalAlpha: 1,
  fillStyle: "",
});

/** A stand-in for the 2D context, which happy-dom can't draw with, holding only what confetti calls. */
const stubContext = () => {
  const context = fakeContext();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the stand-in has only the context's members confetti uses.
  const stub = context as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stub);
  return context;
};

describe("confetti", () => {
  let frames: FrameRequestCallback[];
  const nextFrame = (now: number) => {
    const frame = frames.shift();
    frame?.(now);
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    vi.spyOn(performance, "now").mockReturnValue(0);
  });

  it("bursts from a point in the theme's colours, then removes its canvas", () => {
    const context = stubContext();
    const parent = document.createElement("div");
    parent.style.setProperty("--fd-add", "#1a7f37");
    document.body.append(parent);
    confetti(parent, { x: 100, y: 200 });
    const canvas = parent.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    nextFrame(16);
    expect(context.fillRect).toHaveBeenCalledTimes(120);
    expect(context.fillStyle).toBe("#1a7f37");
    nextFrame(2000);
    expect(context.globalAlpha).toBeLessThan(1);
    nextFrame(2201);
    expect(canvas.isConnected).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("falls back to green without the theme's colours, and stops once its canvas is gone", () => {
    const context = stubContext();
    vi.stubGlobal("devicePixelRatio", 0);
    const parent = document.createElement("div");
    document.body.append(parent);
    confetti(parent, { x: 0, y: 0 });
    nextFrame(16);
    expect(context.fillStyle).toBe("#2da44e");
    parent.replaceChildren();
    nextFrame(32);
    expect(frames).toHaveLength(0);
  });

  it("does nothing without a canvas to draw on", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const parent = document.createElement("div");
    confetti(parent, { x: 0, y: 0 });
    expect(parent.querySelector("canvas")).toBeNull();
  });

  it("does nothing for readers who prefer reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const parent = document.createElement("div");
    confetti(parent, { x: 0, y: 0 });
    expect(parent.children).toHaveLength(0);
  });
});
