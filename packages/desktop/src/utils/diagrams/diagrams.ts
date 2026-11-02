import type { renderAsync } from "pele/lazy";
import { useEffect, type RefObject } from "react";

import { i18n } from "@/utils/i18n/i18n";

let pele: Promise<typeof renderAsync> | null = null;
let drawn = 0;
const WIDTH = 800;
const ROOM = 1.3;

async function load(): Promise<typeof renderAsync | null> {
  pele ??= import("pele/lazy").then((m) => m.renderAsync);
  try {
    return await pele;
  } catch {
    pele = null;
    return null;
  }
}

async function drawOne(render: typeof renderAsync, pre: HTMLPreElement) {
  const source = pre.textContent;
  const room = pre.parentElement!.clientWidth;
  try {
    const { svg } = await render(source, {
      links: false,
      images: false,
      idPrefix: `diagram-${++drawn}-`,
      maxWidth: Math.round((room > 0 ? room : WIDTH) * ROOM),
      autoDirection: true,
      directionBreakpoint: Number.MAX_SAFE_INTEGER,
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    if (!pre.isConnected) return;
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

async function draw(blocks: HTMLPreElement[]) {
  const render = await load();
  if (!render) return;
  await Promise.all(blocks.filter((pre) => pre.isConnected).map((pre) => drawOne(render, pre)));
}

export function useDiagrams(ref: RefObject<HTMLElement | null>, html: string) {
  useEffect(() => {
    if (!html) return;
    const blocks = [...(ref.current?.querySelectorAll<HTMLPreElement>("pre[data-mermaid]") ?? [])];
    if (blocks.length > 0) void draw(blocks);
  }, [ref, html]);
}
