import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { confetti } from "@/utils/confetti/confetti";

const frames: Array<(now: number) => void> = [];
const context = {
  scale: vi.fn<() => void>(),
  clearRect: vi.fn<() => void>(),
  save: vi.fn<() => void>(),
  translate: vi.fn<() => void>(),
  rotate: vi.fn<() => void>(),
  fillRect: vi.fn<() => void>(),
  restore: vi.fn<() => void>(),
  globalAlpha: 1,
  fillStyle: "",
};

function stub(reduced: boolean, drawable = true) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.stubGlobal("requestAnimationFrame", (f: (now: number) => void) => frames.push(f));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in with only what the burst draws with
    drawable ? (context as unknown as CanvasRenderingContext2D) : null,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  frames.length = 0;
  document.body.replaceChildren();
});

describe("confetti", () => {
  it("bursts on a canvas over the window, then takes it away", () => {
    stub(false);
    vi.spyOn(performance, "now").mockReturnValue(0);
    confetti({ x: 100, y: 500 });
    const canvas = document.querySelector("canvas")!;
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    frames.shift()!(16);
    expect(context.fillRect).toHaveBeenCalled();
    frames.shift()!(5000);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("stops when its canvas has gone", () => {
    stub(false);
    vi.spyOn(performance, "now").mockReturnValue(0);
    confetti({ x: 0, y: 0 });
    document.body.replaceChildren();
    context.fillRect.mockClear();
    frames.shift()!(16);
    expect(context.fillRect).not.toHaveBeenCalled();
  });

  it("does nothing for someone who asked for less motion, or without a canvas", () => {
    stub(true);
    confetti({ x: 0, y: 0 });
    expect(document.querySelector("canvas")).toBeNull();
    vi.unstubAllGlobals();
    stub(false, false);
    confetti({ x: 0, y: 0 });
    expect(document.querySelector("canvas")).toBeNull();
  });
});
