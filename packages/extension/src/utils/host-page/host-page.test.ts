// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

describe("GitHub's page", () => {
  it("gets back its language and loses the platform the app's modules set", async () => {
    vi.resetModules();
    document.documentElement.setAttribute("lang", "en");
    document.documentElement.removeAttribute("data-platform");
    const { restoreHostPage } = await import("./host-page");
    document.documentElement.setAttribute("lang", "pt-BR");
    document.documentElement.dataset.platform = "macos";
    restoreHostPage();
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.hasAttribute("data-platform")).toBe(false);
    restoreHostPage();
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("keeps a platform GitHub set itself", async () => {
    vi.resetModules();
    document.documentElement.removeAttribute("lang");
    document.documentElement.dataset.platform = "github";
    const { restoreHostPage } = await import("./host-page");
    document.documentElement.setAttribute("lang", "en");
    restoreHostPage();
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
    expect(document.documentElement.dataset.platform).toBe("github");
  });
});
