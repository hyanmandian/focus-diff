// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { isDark, watchAppearance } from "./bar-theme";

const system = (dark: boolean) => {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return listeners;
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.colorMode;
});

describe("the bar's appearance", () => {
  it("is the one picked in Settings", () => {
    system(true);
    expect(isDark("light")).toBe(false);
    expect(isDark("dark")).toBe(true);
  });

  it("follows GitHub's own with the system's, and the system's when GitHub follows it", () => {
    system(true);
    expect(isDark("system")).toBe(true);
    document.documentElement.dataset.colorMode = "light";
    expect(isDark("system")).toBe(false);
    system(false);
    document.documentElement.dataset.colorMode = "dark";
    expect(isDark("system")).toBe(true);
    document.documentElement.dataset.colorMode = "auto";
    expect(isDark("system")).toBe(false);
  });

  it("hears GitHub's and the system's changes until told to stop", async () => {
    const listeners = system(false);
    const changed = vi.fn<() => void>();
    const stop = watchAppearance(changed);
    document.documentElement.dataset.colorMode = "dark";
    await vi.waitFor(() => {
      expect(changed).toHaveBeenCalledOnce();
    });
    for (const listener of listeners) listener();
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
    document.documentElement.dataset.colorMode = "light";
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
