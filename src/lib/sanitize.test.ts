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

describe("media", () => {
  it("plays GitHub video links and keeps pictures from GitHub only", () => {
    const html = sanitize('<p><a href="https://github.com/acme/web/releases/download/v1/demo.mp4">https://github.com/acme/web/releases/download/v1/demo.mp4</a></p><img src="https://evil.com/x.png"><img src="https://github.com/acme/web/releases/download/v1/a.png">');
    expect(html).toContain('<video src="https://github.com/acme/web/releases/download/v1/demo.mp4"');
    expect(html).toContain("controls");
    expect(html).not.toContain("evil.com");
    expect(html).toContain('loading="lazy"');
  });
});

describe("diagrams", () => {
  it("keeps a mermaid block's source, marked to draw, without GitHub's loading placeholder", () => {
    const html = sanitize(
      '<section class="js-render-needs-enrichment" data-type="mermaid" data-src="https://viewscreen.githubusercontent.com/markdown/mermaid"><div data-plain="x"><div><pre lang="mermaid">flowchart LR\n  A --&gt; B</pre></div></div><span><span>Loading</span></span></section>',
    );
    expect(html).toBe("<pre data-mermaid=\"\">flowchart LR\n  A --&gt; B</pre>");
  });
});

describe("picture buttons", () => {
  it("turns a link around a small labelled picture into a button with its words", () => {
    const html = sanitize(
      '<a href="https://cursor.com/agents/1?x=1" rel="nofollow"><themed-picture><picture><source media="(prefers-color-scheme: dark)" srcset="https://camo.githubusercontent.com/d"><img alt="Open in Web" width="114" height="28" src="https://camo.githubusercontent.com/d"></picture></themed-picture></a>',
    );
    expect(html).toBe('<a href="https://cursor.com/agents/1?x=1" data-button="">Open in Web</a>');
  });
  it("leaves a screenshot wrapped in a link to itself a picture", () => {
    const html = sanitize('<a href="https://github.com/user-attachments/assets/a.png"><img alt="shot" height="400" src="https://github.com/user-attachments/assets/a.png"></a>');
    expect(html).toContain("<img");
  });
});
