import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Config } from "@/utils/config/config";

class SystemScheme extends EventTarget implements MediaQueryList {
  readonly media = "(prefers-color-scheme: dark)";
  onchange: MediaQueryList["onchange"] = null;
  constructor(public matches: boolean) {
    super();
  }
  addListener() {}
  removeListener() {}
  change(dark: boolean) {
    this.matches = dark;
    this.dispatchEvent(new Event("change"));
  }
}

async function load(dark: boolean) {
  vi.resetModules();
  const system = new SystemScheme(dark);
  vi.spyOn(window, "matchMedia").mockReturnValue(system);
  const { useTheme } = await import("@/utils/theme/theme");
  return { system, useTheme };
}

const isDark = () => document.documentElement.classList.contains("dark");

describe("the theme", () => {
  it("opens in the one picked last time, before the settings arrive", async () => {
    localStorage.setItem("theme", "dark");
    await load(false);
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    localStorage.setItem("theme", "light");
    await load(true);
    expect(isDark()).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("follows the system with nothing (or nothing sensible) remembered", async () => {
    await load(true);
    expect(isDark()).toBe(true);
    localStorage.setItem("theme", "neon");
    await load(false);
    expect(isDark()).toBe(false);
  });

  it("follows the system when storage can't be read", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    await load(true);
    expect(isDark()).toBe(true);
  });

  it("applies and remembers the pick from the settings", async () => {
    const { useTheme } = await load(false);
    const { rerender } = renderHook(
      ({ theme }: { theme: Config["theme"] | undefined }) => {
        useTheme(theme);
      },
      { initialProps: { theme: "dark" } },
    );
    expect(isDark()).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    rerender({ theme: "light" });
    expect(isDark()).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
    rerender({ theme: "light" });
    expect(isDark()).toBe(false);
  });

  it("uses last time's pick until the settings arrive", async () => {
    localStorage.setItem("theme", "dark");
    const { useTheme } = await load(false);
    const settings: { theme?: Config["theme"] } = {};
    renderHook(() => {
      useTheme(settings.theme);
    });
    expect(isDark()).toBe(true);
  });

  it("still applies the pick when it can't be remembered", async () => {
    const { useTheme } = await load(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    renderHook(() => {
      useTheme("dark");
    });
    expect(isDark()).toBe(true);
  });

  it("follows the system changing while set to System, until it's gone", async () => {
    const { system, useTheme } = await load(false);
    const { unmount } = renderHook(() => {
      useTheme("system");
    });
    expect(isDark()).toBe(false);
    act(() => {
      system.change(true);
    });
    expect(isDark()).toBe(true);
    unmount();
    system.change(false);
    expect(isDark()).toBe(true);
  });
});
