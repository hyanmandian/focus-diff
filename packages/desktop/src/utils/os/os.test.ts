import { describe, expect, it, vi } from "vite-plus/test";

/** The module as a web view with this user agent loads it. */
function load(agent: string) {
  vi.resetModules();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
  return import("./os");
}

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36";

describe("the operating system", () => {
  it("tells the desktop from the web view, the Mac being the default", async () => {
    expect((await load(MAC)).os).toBe("macos");
    expect((await load(WINDOWS)).os).toBe("windows");
    expect((await load(LINUX)).os).toBe("linux");
    expect((await load(ANDROID)).os).toBe("macos");
  });

  it("marks the page with it for the stylesheet", async () => {
    await load(WINDOWS);
    expect(document.documentElement.dataset.platform).toBe("windows");
  });

  it("writes shortcuts the way the system does", async () => {
    const mac = await load(MAC);
    expect(mac.isMac).toBe(true);
    expect(mac.shortcut("↩", ["shift", "cmd"])).toBe("⇧⌘↩");
    expect(mac.shortcut("K")).toBe("K");
    const windows = await load(WINDOWS);
    expect(windows.isMac).toBe(false);
    expect(windows.shortcut("Enter", ["ctrl", "alt", "shift", "cmd"])).toBe("Ctrl+Alt+Shift+Ctrl+Enter");
    expect(windows.shortcut("K")).toBe("K");
  });

  it("draws the window as inactive while it isn't the key one", async () => {
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await load(MAC);
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(false);
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(true);
    focused.mockReturnValue(true);
    window.dispatchEvent(new Event("focus"));
    expect(document.documentElement.hasAttribute("data-window-inactive")).toBe(false);
  });
});
