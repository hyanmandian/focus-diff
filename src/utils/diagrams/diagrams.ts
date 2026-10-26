// Mermaid diagrams in descriptions and comments, drawn as GitHub draws them. Mermaid is large, so
// it's loaded only once a page has one, and draws in strict mode: labels sanitized, no scripts, no
// click handlers. The source stays a click away under the drawing.

import type mermaidApi from "mermaid";
import { useEffect, type RefObject } from "react";

type Mermaid = typeof mermaidApi;

let mermaid: Promise<Mermaid> | null = null;
let drawn = 0;

async function draw(blocks: HTMLPreElement[]) {
  mermaid ??= import("mermaid").then((m) => m.default);
  const m = await mermaid;
  m.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
    fontFamily: getComputedStyle(document.body).fontFamily,
  });
  for (const pre of blocks) {
    if (!pre.isConnected) continue;
    const source = pre.textContent;
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time: mermaid draws each in a scratch element of the page
      const { svg } = await m.render(`diagram-${++drawn}`, source);
      const figure = document.createElement("figure");
      figure.className = "diagram";
      const picture = document.createElement("div");
      picture.setAttribute("role", "img");
      picture.setAttribute("aria-label", `Diagram: ${source.split("\n")[0]!.trim()}`);
      // Mermaid's own output in strict mode (DOMPurify-cleaned); the page's CSP blocks scripts too.
      picture.innerHTML = svg;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Source";
      details.append(summary, pre.cloneNode(true));
      figure.append(picture, details);
      pre.replaceWith(figure);
    } catch {
      // Not a diagram mermaid can draw: its source stays, as GitHub leaves it.
    }
  }
}

/** Draws the diagrams in what `ref` shows, whenever `html` changes. */
export function useDiagrams(ref: RefObject<HTMLElement | null>, html: string) {
  useEffect(() => {
    // Nothing shown, nothing to draw; each new HTML, its diagrams to find.
    if (!html) return;
    const blocks = [...(ref.current?.querySelectorAll<HTMLPreElement>("pre[data-mermaid]") ?? [])];
    if (blocks.length > 0) void draw(blocks);
  }, [ref, html]);
}
