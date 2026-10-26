import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vite-plus/test";

import { avatar } from "@/utils/avatar/avatar";

const github = "https://avatars.githubusercontent.com/u/11?v=4&size=420";

describe("a person's picture", () => {
  it("asks for the size it's drawn at", () => {
    expect(avatar(github)).toBe("https://avatars.githubusercontent.com/u/11?v=4&s=48");
    expect(avatar("https://example.com/me.png", 40)).toBe("https://example.com/me.png?s=40");
  });

  it("comes through the app's cache in the app", () => {
    mockIPC(() => null);
    expect(avatar(github)).toBe("avatar://localhost/u/11?v=4&s=48");
    // Pictures from elsewhere aren't cached.
    expect(avatar("https://example.com/me.png")).toBe("https://example.com/me.png?s=48");
  });

  it("uses the http form of the scheme on Windows", () => {
    mockIPC(() => null);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(avatar(github, 64)).toBe("http://avatar.localhost/u/11?v=4&s=64");
  });

  it("goes straight to GitHub in the browser's sample mode", () => {
    mockIPC(() => null);
    vi.stubGlobal("__mock", true);
    expect(avatar(github)).toBe("https://avatars.githubusercontent.com/u/11?v=4&s=48");
    vi.unstubAllGlobals();
  });

  it("leaves something that isn't a URL as it is", () => {
    expect(avatar("not a url")).toBe("not a url");
  });
});
