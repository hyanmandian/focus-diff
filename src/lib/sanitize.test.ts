// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitize } from "./sanitize";

describe("sanitize", () => {
  it("keeps formatting", () => {
    expect(sanitize("<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>")).toBe("<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>");
  });

  it("drops scripts, handlers and dangerous links", () => {
    const out = sanitize('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><iframe src="https://evil"></iframe><a href="https://github.com" target="_blank" style="x">c</a>');
    expect(out).not.toMatch(/script|onclick|javascript|iframe|target|style/);
    expect(out).toContain('<a href="https://github.com">c</a>');
  });

  it("keeps only GitHub's images", () => {
    expect(sanitize('<img src="https://user-images.githubusercontent.com/a.png" alt="x">')).toContain("<img");
    expect(sanitize('<img src="https://evil.example/a.png">')).toBe("");
  });

  it("unwraps unknown tags and disables task checkboxes", () => {
    expect(sanitize("<custom-el><b>x</b></custom-el>")).toBe("<b>x</b>");
    expect(sanitize('<input type="checkbox" checked>')).toBe('<input type="checkbox" checked="" disabled="">');
  });
});
