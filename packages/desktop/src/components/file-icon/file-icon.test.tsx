import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { FileIcon } from "@/components/file-icon/file-icon";

const tile = (path: string) => {
  const { container } = render(<FileIcon path={path} />);
  const span = container.querySelector("span");
  return span ? { label: span.textContent, color: span.style.backgroundColor, dark: span.className } : null;
};
const glyph = (path: string) => {
  const { container } = render(<FileIcon path={path} className="extra" />);
  return container.querySelector("svg")?.getAttribute("class") ?? null;
};

describe("FileIcon", () => {
  it("marks a file by its language, in the language's color", () => {
    expect(tile("src/app/main.tsx")).toMatchObject({ label: "TSX", color: "#3178c6" });
    expect(tile("Cargo.RS")).toMatchObject({ label: "RS" });
    expect(tile("src/app/main.tsx")?.dark).toContain("text-white");
  });

  it("writes dark on light colors", () => {
    expect(tile("index.js")?.dark).toContain("text-black/80");
  });

  it("knows some files by name, and any .env", () => {
    expect(tile("docker/Dockerfile")?.label).toBe("DOC");
    expect(tile("Makefile")?.label).toBe("MK");
    expect(tile(".env.local")?.label).toBe("ENV");
  });

  it("draws a glyph for locks and pictures, and a plain file otherwise", () => {
    expect(glyph("package-lock.json")).toContain("lucide-lock");
    expect(glyph("bun.lockb")).toContain("lucide-lock");
    expect(glyph("docs/screenshot.PNG")).toContain("lucide-file-image");
    expect(glyph("LICENSE")).toContain("lucide-file");
    expect(glyph("notes.unknown")).toContain("lucide-file");
    // A dotfile's name isn't its extension.
    expect(glyph(".gitignore")).toContain("lucide-file");
    expect(glyph("LICENSE")).toContain("extra");
  });
});
