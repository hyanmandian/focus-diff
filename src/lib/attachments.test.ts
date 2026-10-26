import { describe, expect, it } from "vitest";
import { attachable, markdownFor, pngDensity, uploadMark, swap } from "./attachments";

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
    expect(markdownFor("image", "https://github.com/user-attachments/assets/1", "Screen Shot.png", 800)).toBe('<img width="800" alt="Screen Shot" src="https://github.com/user-attachments/assets/1" />');
    expect(markdownFor("image", "https://github.com/user-attachments/assets/1", "a.svg", null)).toBe("![a](https://github.com/user-attachments/assets/1)");
    expect(markdownFor("video", "https://github.com/user-attachments/assets/2", "clip.mov", null)).toBe("https://github.com/user-attachments/assets/2");
  });

  it("takes only what GitHub does", () => {
    expect(attachable(new File([], "a.PNG"))).toBe(true);
    expect(attachable(new File([], "clip", { type: "video/mp4" }))).toBe(true);
    expect(attachable(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("pngDensity", () => {
  const chunk = (type: string, data: number[]) => {
    const length = [0, 0, 0, data.length];
    return [...length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  };
  const png = (...chunks: number[][]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
  const perMeter = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

  it("reads a Retina screenshot's 144 pixels per inch", () => {
    expect(pngDensity(png(chunk("IHDR", Array(13).fill(0)), chunk("pHYs", [...perMeter(5669), ...perMeter(5669), 1])))).toBe(144);
  });

  it("says nothing when the file doesn't", () => {
    expect(pngDensity(png(chunk("IHDR", Array(13).fill(0)), chunk("IDAT", [1])))).toBeNull();
    expect(pngDensity(png(chunk("pHYs", [...perMeter(1), ...perMeter(1), 0])))).toBeNull();
  });
});
