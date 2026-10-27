import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { emit, mockCommands } from "../fake-platform/fake-platform";
import { attachable, displayWidth, markdownFor, pngDensity, swap, uploadMark, useWebSession } from "./attachments";

/** A PNG chunk: its length, type, data and a (blank) checksum. */
const chunk = (type: string, data: number[]) => [
  0,
  0,
  0,
  data.length,
  ...Array.from(type, (c) => c.codePointAt(0)!),
  ...data,
  0,
  0,
  0,
  0,
];
const png = (...chunks: number[][]) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
const perMeter = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const header = chunk(
  "IHDR",
  Array.from({ length: 13 }, () => 0),
);
const retina = png(header, chunk("pHYs", [...perMeter(5669), ...perMeter(5669), 1]));

/** Pictures decode at once, `width` pixels wide. */
const decoded = (width: number) => {
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(width);
};

/** Rust answering who's signed in on github.com with `login`. */
const session = (login: () => unknown) => (cmd: string) => (cmd === "github_web_session" ? login() : null);

/** Unmounts, and lets it stop listening while the fake platform is still there. */
const stop = async (unmount: () => void) => {
  unmount();
  await act(async () => {});
};

/** A promise to settle later, from the test. */
function later<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("placeholders", () => {
  it("gives each upload its own", () => {
    const first = uploadMark("shot.png", "Uploading {name}…", "");
    expect(first).toBe("![Uploading shot.png…]()");
    expect(uploadMark("shot.png", "Uploading {name}…", `a ${first}`)).toBe("![Uploading shot.png (2)…]()");
  });

  it("swaps one for what was uploaded, or takes it out with its line", () => {
    const mark = "![Uploading a.png…]()";
    expect(swap(`hi\n${mark}\nbye`, mark, "<img />")).toBe("hi\n<img />\nbye");
    expect(swap(`hi\n${mark}\nbye`, mark, "")).toBe("hi\nbye");
    expect(swap(`see ${mark} here`, mark, "")).toBe("see  here");
    expect(swap("edited away", mark, "x")).toBe("edited away");
  });
});

describe("markdownFor", () => {
  it("writes pictures and videos as GitHub does", () => {
    expect(markdownFor("image", "https://github.com/user-attachments/assets/1", "Screen Shot.png", 800)).toBe(
      '<img width="800" alt="Screen Shot" src="https://github.com/user-attachments/assets/1" />',
    );
    expect(markdownFor("image", "https://github.com/user-attachments/assets/1", "a.svg", null)).toBe(
      "![a](https://github.com/user-attachments/assets/1)",
    );
    expect(markdownFor("video", "https://github.com/user-attachments/assets/2", "clip.mov", null)).toBe(
      "https://github.com/user-attachments/assets/2",
    );
  });

  it("takes only what GitHub does", () => {
    expect(attachable(new File([], "a.PNG"))).toBe(true);
    expect(attachable(new File([], "clip", { type: "video/mp4" }))).toBe(true);
    expect(attachable(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("pngDensity", () => {
  it("reads a Retina screenshot's 144 pixels per inch", () => {
    expect(pngDensity(retina)).toBe(144);
  });

  it("says nothing when the file doesn't", () => {
    expect(pngDensity(png(header, chunk("IDAT", [1])))).toBeNull();
    expect(pngDensity(png(header, chunk("IEND", [])))).toBeNull();
    expect(pngDensity(png(chunk("pHYs", [...perMeter(1), ...perMeter(1), 0])))).toBeNull();
    // Cut short: no chunk after the header, or a pHYs without its data.
    expect(pngDensity(png(header))).toBeNull();
    expect(pngDensity(png(chunk("pHYs", [1, 2])))).toBeNull();
    expect(pngDensity(png(chunk("pHYs", [...perMeter(1), ...perMeter(1), 1])).subarray(0, 24))).toBeNull();
  });
});

describe("displayWidth", () => {
  it("is the picture's width, halved for a Retina PNG", async () => {
    decoded(1600);
    expect(await displayWidth(new File([retina], "a.png", { type: "image/png" }))).toBe(800);
    expect(await displayWidth(new File([png(header)], "a.png", { type: "image/png" }))).toBe(1600);
    expect(await displayWidth(new File([retina], "a.jpg", { type: "image/jpeg" }))).toBe(1600);
  });

  it("keeps a PNG's width when it isn't dense enough to be Retina", async () => {
    decoded(500);
    const plain = png(header, chunk("pHYs", [...perMeter(2835), ...perMeter(2835), 1]));
    expect(await displayWidth(new File([plain], "a.png", { type: "image/png" }))).toBe(500);
  });

  it("is none for a video, a picture with no width, or one that can't be read", async () => {
    expect(await displayWidth(new File([], "a.mp4", { type: "video/mp4" }))).toBeNull();
    decoded(0);
    expect(await displayWidth(new File([], "a.gif", { type: "image/gif" }))).toBeNull();
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("broken"));
    expect(await displayWidth(new File([], "a.gif", { type: "image/gif" }))).toBeNull();
  });
});

describe("useWebSession", () => {
  it("is who's signed in on github.com, and follows changes", async () => {
    mockCommands(session(() => "ana"));
    const { result, unmount } = renderHook(() => useWebSession());
    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current).toBe("ana");
    });
    await act(() => emit("web-session", null));
    expect(result.current).toBeNull();
    await stop(unmount);
  });

  it("is nobody when it can't be told", async () => {
    mockCommands(() => Promise.reject(new Error("offline")));
    const { result, unmount } = renderHook(() => useWebSession());
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    await stop(unmount);
  });

  it("stops listening once gone", async () => {
    const answer = later<string>();
    mockCommands(session(() => answer.promise));
    const { result, unmount } = renderHook(() => useWebSession());
    await stop(unmount);
    answer.settle("late");
    await act(() => emit("web-session", "later"));
    expect(result.current).toBeUndefined();
  });
});
