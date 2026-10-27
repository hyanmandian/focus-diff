// @vitest-environment happy-dom
import { describe, expect, it } from "vite-plus/test";

import { leadsElsewhere, sanitize } from "@/utils/sanitize/sanitize";

/** A picture with a dark version, a second `media` one, and a fallback. */
const picture = (media: string) =>
  sanitize(
    `<picture><source media="(prefers-color-scheme: dark)" srcset="https://github.com/d.png 1x"><source ${media} srcset="https://github.com/l.png"><img src="https://github.com/x.png"></picture>`,
  );

/** The picture in some HTML, on the page. */
const imgIn = (html: string) => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.querySelector("img")!;
};

describe("sanitize", () => {
  it("keeps formatting", () => {
    expect(sanitize("<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>")).toBe(
      "<p>Hi <strong>there</strong> <code>x</code></p><ul><li>a</li></ul>",
    );
  });

  it("drops scripts, handlers and dangerous links", () => {
    const out = sanitize(
      '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><iframe src="https://evil"></iframe><a href="https://github.com" target="_blank" style="x">c</a>',
    );
    expect(out).not.toMatch(/script|onclick|javascript|iframe|target|style/u);
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

  it("drops other inputs, comments and pictures without an address", () => {
    expect(sanitize('<input type="text" value="x">')).toBe("");
    expect(sanitize("<p>a<!-- hidden -->b</p>")).toBe("<p>ab</p>");
    expect(sanitize('<img alt="x">')).toBe("");
  });

  it("keeps a link with no address as its text", () => {
    expect(sanitize('<a name="x">anchor</a>')).toBe("<a>anchor</a>");
  });
});

describe("media", () => {
  it("plays GitHub video links and keeps pictures from GitHub only", () => {
    const html = sanitize(
      '<p><a href="https://github.com/acme/web/releases/download/v1/demo.mp4">https://github.com/acme/web/releases/download/v1/demo.mp4</a></p><img src="https://evil.com/x.png"><img src="https://github.com/acme/web/releases/download/v1/a.png">',
    );
    expect(html).toContain('<video src="https://github.com/acme/web/releases/download/v1/demo.mp4"');
    expect(html).toContain("controls");
    expect(html).not.toContain("evil.com");
    expect(html).toContain('loading="lazy"');
  });

  it("gives a GitHub video controls, played through the app", () => {
    const src = "https://github.com/user-attachments/assets/demo.mp4";
    const html = sanitize(`<video src="${src}" autoplay></video>`);
    expect(html).toContain(`data-original="${src}"`);
    expect(html).toContain('controls=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toContain("autoplay");
  });

  it("shows a picture's version for the theme showing", () => {
    expect(picture('media="(prefers-color-scheme: light)"')).toContain('data-original="https://github.com/l.png"');
    document.documentElement.classList.add("dark");
    expect(picture("")).toContain('data-original="https://github.com/d.png"');
    document.documentElement.classList.remove("dark");
    // No version for the theme: the picture as it was.
    expect(picture("")).toContain('data-original="https://github.com/x.png"');
    expect(sanitize('<picture><source srcset="https://github.com/l.png"></picture>')).toBe("");
  });
});

describe("diagrams", () => {
  it("keeps a mermaid block's source, marked to draw, without GitHub's loading placeholder", () => {
    const html = sanitize(
      '<section class="js-render-needs-enrichment" data-type="mermaid" data-src="https://viewscreen.githubusercontent.com/markdown/mermaid"><div data-plain="x"><div><pre lang="mermaid">flowchart LR\n  A --&gt; B</pre></div></div><span><span>Loading</span></span></section>',
    );
    expect(html).toBe('<pre data-mermaid="">flowchart LR\n  A --&gt; B</pre>');
  });

  it("keeps other diagrams' source unmarked, and an empty one empty", () => {
    expect(sanitize('<section data-type="geojson"><pre>{}</pre></section>')).toBe("<pre>{}</pre>");
    expect(sanitize('<section data-type="mermaid"><span>Loading</span></section>')).toBe('<pre data-mermaid=""></pre>');
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
    const html = sanitize(
      '<a href="https://github.com/user-attachments/assets/a.png"><img alt="shot" height="400" src="https://github.com/user-attachments/assets/a.png"></a>',
    );
    expect(html).toContain("<img");
  });

  it("leaves a link with words, or a picture without a label or size, a link", () => {
    const img = 'src="https://github.com/b.png"';
    expect(sanitize(`<a href="https://x.dev">Go <img alt="Go" height="20" ${img}></a>`)).toContain("Go <img");
    expect(sanitize(`<a href="https://x.dev"><img height="20" ${img}></a>`)).toContain("<img");
    expect(sanitize(`<a href="https://x.dev"><img alt="Go" ${img}></a>`)).toContain("<img");
  });

  it("makes a button with no address when it had no https one", () => {
    expect(sanitize('<a><img alt="Run" height="20" src="https://github.com/b.png"></a>')).toBe(
      '<a data-button="">Run</a>',
    );
  });
});

describe("leadsElsewhere", () => {
  it("is a picture in a link to a page", () => {
    expect(leadsElsewhere(imgIn('<a href="https://ci.dev/run/1"><img></a>'))).toBe(true);
  });

  it("isn't a picture alone, or linked to itself or another picture", () => {
    expect(leadsElsewhere(imgIn("<img>"))).toBe(false);
    expect(leadsElsewhere(imgIn('<a href="https://github.com/a/b"><img></a>'))).toBe(false);
    expect(leadsElsewhere(imgIn('<a href="https://ci.dev/badge.png?x=1"><img></a>'))).toBe(false);
  });
});

describe("suggested changes", () => {
  it("draws GitHub's suggestion as a diff of text, with only its syntax colors' names", () => {
    const html = sanitize(
      '<div class="my-2 border rounded-2 js-suggested-changes-blob diff-view" id=""><div class="f6 p-2">Suggested change</div><div itemprop="text" class="blob-wrapper" style="margin: 0"><table class="d-table" data-paste-markdown-skip=""><tbody><tr class="border-0"><td class="blob-num blob-num-deletion" data-line-number="·"></td><td class="border-0 blob-code-inner blob-code-deletion js-blob-code-deletion"><span class="pl-k">const</span> a = <span class="pl-c1" onclick="x()">1</span>;</td></tr><tr class="border-0"><td class="blob-num blob-num-addition" data-line-number="·"></td><td class="border-0 blob-code-inner blob-code-addition"><span class="pl-k evil">const</span> a = <img src="https://evil.example/x.png">2;</td></tr></tbody></table></div><div class="js-apply-changes"></div></div><p>Then it works.</p>',
    );
    expect(html).toBe(
      '<div data-suggestion=""><p data-suggestion-head="">Suggested change</p><table><tbody><tr data-diff="deletion"><td data-sign="">−</td><td><span data-pl="k">const</span> a = <span data-pl="c1">1</span>;</td></tr><tr data-diff="addition"><td data-sign="">+</td><td><span data-pl="k">const</span> a = 2;</td></tr></tbody></table></div><p>Then it works.</p>',
    );
  });

  it("draws a previewed suggestion under the lines it replaces", () => {
    const html = sanitize(
      '<pre lang="suggestion" class="notranslate"><code class="notranslate">  const a = 2;\n</code></pre>',
      ["  const a = 1;"],
    );
    expect(html).toContain(
      '<tr data-diff="deletion"><td data-sign="">−</td><td>  const a = 1;</td></tr><tr data-diff="addition"><td data-sign="">+</td><td>  const a = 2;</td></tr>',
    );
  });

  it("draws a previewed suggestion that removes the lines, with nothing known of them", () => {
    expect(sanitize('<pre lang="suggestion"></pre>')).toBe(
      '<div data-suggestion=""><p data-suggestion-head="">Suggested change</p><table><tbody></tbody></table></div>',
    );
  });

  it("reads a suggestion's rows from their second cell when unmarked, skipping rows without one", () => {
    const html = sanitize(
      '<div class="js-suggested-changes-blob"><table><tbody><tr><td></td><td>x<!-- note --></td></tr><tr><td>only</td></tr></tbody></table></div>',
    );
    expect(html).toContain('<tbody><tr data-diff="addition"><td data-sign="">+</td><td>x</td></tr></tbody>');
  });
});
