import type mermaidApi from "mermaid";
import { useEffect, type RefObject } from "react";

import { i18n } from "@/utils/i18n/i18n";

type Mermaid = typeof mermaidApi;

let mermaid: Promise<Mermaid> | null = null;
let drawn = 0;

async function load(): Promise<Mermaid | null> {
  mermaid ??= import("mermaid").then((m) => m.default);
  try {
    const m = await mermaid;
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    return m;
  } catch {
    mermaid = null;
    return null;
  }
}

async function draw(blocks: HTMLPreElement[]) {
  const m = await load();
  if (!m) return;
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
      picture.setAttribute("aria-label", i18n()("shared.diagram", { first: source.split("\n")[0]!.trim() }));
      picture.innerHTML = svg;
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = i18n()("shared.diagramSource");
      details.append(summary, pre.cloneNode(true));
      figure.append(picture, details);
      pre.replaceWith(figure);
    } catch {}
  }
}

export function useDiagrams(ref: RefObject<HTMLElement | null>, html: string) {
  useEffect(() => {
    if (!html) return;
    const blocks = [...(ref.current?.querySelectorAll<HTMLPreElement>("pre[data-mermaid]") ?? [])];
    if (blocks.length > 0) void draw(blocks);
  }, [ref, html]);
}
