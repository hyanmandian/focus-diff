import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vite-plus/test";

import { isVideo, media } from "@/utils/media/media";

const url = "https://github.com/user-attachments/assets/a b.png";

describe("pictures and videos from GitHub", () => {
  it("load straight from GitHub outside the app", () => {
    expect(media(url)).toBe(url);
  });

  it("come through the app, which holds the token", () => {
    mockIPC(() => null);
    expect(media(url)).toBe(`media://localhost/?u=${encodeURIComponent(url)}`);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(media(url)).toBe(`http://media.localhost/?u=${encodeURIComponent(url)}`);
  });

  it("load straight from GitHub in the browser's sample mode", () => {
    mockIPC(() => null);
    vi.stubGlobal("__mock", true);
    expect(media(url)).toBe(url);
    vi.unstubAllGlobals();
  });

  it("tells a video by its extension", () => {
    expect(isVideo("https://x.test/clip.MP4")).toBe(true);
    expect(isVideo("https://x.test/clip.webm?raw=1")).toBe(true);
    expect(isVideo("https://x.test/shot.png")).toBe(false);
    expect(isVideo("https://x.test/movie.mp4.png")).toBe(false);
  });
});
