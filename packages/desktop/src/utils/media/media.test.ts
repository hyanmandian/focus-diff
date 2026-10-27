import { describe, expect, it } from "vite-plus/test";

import { fakePlatform } from "../fake-platform/fake-platform";
import { setPlatform } from "../platform/platform";
import { isVideo, media } from "./media";

const url = "https://github.com/user-attachments/assets/a b.png";

describe("pictures and videos from GitHub", () => {
  it("load straight from GitHub when the app keeps no copies", () => {
    expect(media(url)).toBe(url);
  });

  it("come through the app where it can, which holds the token", () => {
    setPlatform({ ...fakePlatform, mediaUrl: (kind, address) => `${kind}:${address}` });
    try {
      expect(media(url)).toBe(`media:${url}`);
    } finally {
      setPlatform(fakePlatform);
    }
  });

  it("tells a video by its extension", () => {
    expect(isVideo("https://x.test/clip.MP4")).toBe(true);
    expect(isVideo("https://x.test/clip.webm?raw=1")).toBe(true);
    expect(isVideo("https://x.test/shot.png")).toBe(false);
    expect(isVideo("https://x.test/movie.mp4.png")).toBe(false);
  });
});
