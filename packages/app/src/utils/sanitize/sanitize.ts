// HTML from GitHub (bodyHTML of descriptions and comments) is already sanitized by GitHub. This is a
// second line: only an allowlist of tags and attributes survives, links must be https (or anchors),
// pictures and videos must come from GitHub's own hosts (and load through the app, utils/media/media.ts),
// and everything else is dropped or unwrapped. The page's Content-Security-Policy blocks scripts on
// top of that.

import { i18n } from "../i18n/i18n";
import { isVideo, media } from "../media/media";

const TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "video",
]);
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "button",
  "textarea",
  "select",
  "svg",
  "math",
  "link",
  "meta",
  "base",
  "template",
  "audio",
  "source",
  "track",
]);
const ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title", "data-button"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  video: new Set(["src", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  td: new Set(["align", "colspan", "rowspan"]),
  th: new Set(["align", "colspan", "rowspan"]),
  ol: new Set(["start"]),
  details: new Set(["open"]),
  pre: new Set(["data-mermaid"]),
};
const IMAGE_HOSTS = /^https:\/\/(?:[\w-]+\.)*(?:githubusercontent\.com|github\.com|githubassets\.com)\//u;

const isDark = () => document.documentElement.classList.contains("dark");

/** A link whose only content is one small picture with words in its alt text, pointing somewhere
 *  other than the picture itself. */
function isPictureButton(link: Element) {
  const images = link.querySelectorAll("img");
  if (images.length !== 1 || link.textContent?.trim()) return false;
  const img = images[0]!;
  const alt = img.getAttribute("alt")?.trim() ?? "";
  const height = Number(img.getAttribute("height") ?? "0");
  const href = link.getAttribute("href") ?? "";
  return (
    alt.length > 1 && alt.length <= 40 && height > 0 && height <= 40 && !/\.(png|jpe?g|gif|webp|svg)(\?|$)/iu.test(href)
  );
}

// MARK: Suggested changes

type Row = { kind: "deletion" | "addition"; code: Node[] };

/** A suggested change as a small diff the app draws itself (components/suggestion/suggestion.css): GitHub's own is
 *  styled by classes this page doesn't have. Built from scratch, so nothing of the original but its
 *  text (and the names of its syntax colors) gets through. */
function suggestion(doc: Document, rows: Row[]) {
  const box = doc.createElement("div");
  box.dataset.suggestion = "";
  const head = doc.createElement("p");
  head.dataset.suggestionHead = "";
  head.textContent = i18n()("review.suggestedChange");
  const table = doc.createElement("table");
  const body = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    tr.dataset.diff = row.kind;
    const sign = doc.createElement("td");
    sign.dataset.sign = "";
    sign.textContent = row.kind === "deletion" ? "−" : "+";
    const cell = doc.createElement("td");
    cell.append(...row.code);
    tr.append(sign, cell);
    body.append(tr);
  }
  table.append(body);
  box.append(head, table);
  return box;
}

/** A line of highlighted code as text, keeping only GitHub's syntax color names ("pl-k"). */
function code(doc: Document, from: Node): Node[] {
  return Array.from(from.childNodes).flatMap((child): Node[] => {
    if (child.nodeType === Node.TEXT_NODE) return [doc.createTextNode(child.textContent!)];
    if (!(child instanceof Element)) return [];
    const color = [...child.classList].find((c) => /^pl-[a-z0-9]{1,6}$/u.test(c));
    const inner = code(doc, child);
    if (!color) return inner;
    const span = doc.createElement("span");
    span.dataset.pl = color.slice(3);
    span.append(...inner);
    return [span];
  });
}

/** GitHub's suggested change, from a comment's HTML: its rows of removed and added lines. */
function suggestedChange(element: Element) {
  const doc = element.ownerDocument;
  const rows = [...element.querySelectorAll("tr")].flatMap((tr): Row[] => {
    const cell = tr.querySelector(".blob-code-inner, .blob-code") ?? tr.querySelectorAll("td")[1];
    if (!cell) return [];
    return [{ kind: cell.className.includes("deletion") ? "deletion" : "addition", code: code(doc, cell) }];
  });
  return suggestion(doc, rows);
}

/** A ```suggestion block as GitHub's Markdown API renders it (a preview): the lines it suggests,
 *  under the ones they replace when those are known. */
function previewedChange(element: Element, base: string[] | undefined) {
  const doc = element.ownerDocument;
  const text = element.textContent.replace(/\n$/u, "");
  const lines = text ? text.split("\n") : [];
  return suggestion(doc, [
    ...(base ?? []).map((line): Row => ({ kind: "deletion", code: [doc.createTextNode(line)] })),
    ...lines.map((line): Row => ({ kind: "addition", code: [doc.createTextNode(line)] })),
  ]);
}

function clean(node: Node, base?: string[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (!(child instanceof Element)) continue;
    const element = child;
    const tag = element.tagName.toLowerCase();
    if (tag === "div" && element.classList.contains("js-suggested-changes-blob")) {
      element.replaceWith(suggestedChange(element));
      continue;
    }
    if (tag === "pre" && element.getAttribute("lang") === "suggestion") {
      element.replaceWith(previewedChange(element, base));
      continue;
    }
    // GitHub's diagrams (mermaid, maps, 3D) come as their source plus a "Loading" placeholder its
    // own page swaps for the drawing. Here: the source alone, marked for utils/diagrams/diagrams.ts to draw.
    if (tag === "section" && element.hasAttribute("data-type")) {
      const source = element.querySelector("pre")?.textContent ?? "";
      const pre = element.ownerDocument.createElement("pre");
      pre.textContent = source;
      if (element.getAttribute("data-type") === "mermaid") pre.dataset.mermaid = "";
      element.replaceWith(pre);
      continue;
    }
    // A picture with light and dark versions: the one for the theme showing, as GitHub picks.
    if (tag === "picture") {
      const dark = isDark();
      const source = [...element.querySelectorAll("source")].find((s) =>
        (s.getAttribute("media") ?? "").includes(dark ? "dark" : "light"),
      );
      const img = element.querySelector("img");
      const url = source?.getAttribute("srcset")?.trim().split(/\s+/u)[0];
      if (img && url) img.setAttribute("src", url);
    }
    // A button drawn as a picture in a link ("Open in Web", "Fix in Cursor", CI badges with a
    // label): a real button with its words, which reads, themes and clicks like the app's own.
    if (tag === "a" && isPictureButton(element)) {
      const href = element.getAttribute("href") ?? "";
      // isPictureButton has made sure of the picture and its words.
      const label = element.querySelector("img")!.getAttribute("alt")!.trim();
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
      if (href.startsWith("https://")) element.setAttribute("href", href);
      element.setAttribute("data-button", "");
      element.textContent = label;
      continue;
    }
    if (DROP.has(tag)) {
      element.remove();
      continue;
    }
    if (!TAGS.has(tag)) {
      // Keep the text, lose the element.
      clean(element, base);
      element.replaceWith(...element.childNodes);
      continue;
    }
    const allowed = ATTRIBUTES[tag];
    for (const attribute of Array.from(element.attributes)) {
      if (!allowed?.has(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!href.startsWith("https://")) element.removeAttribute("href");
    }
    if (tag === "img" || tag === "video") {
      const src = element.getAttribute("src") ?? "";
      if (!IMAGE_HOSTS.test(src)) {
        element.remove();
        continue;
      }
      element.setAttribute("src", media(src));
      // The original, for opening it in the viewer or the browser.
      element.setAttribute("data-original", src);
      if (tag === "img") element.setAttribute("loading", "lazy");
      else {
        element.setAttribute("controls", "");
        element.setAttribute("preload", "metadata");
        element.setAttribute("playsinline", "");
      }
    }
    // GitHub shows a video it can't embed as a link to it: played here instead.
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (isVideo(href) && IMAGE_HOSTS.test(href) && !element.querySelector("img")) {
        const video = element.ownerDocument.createElement("video");
        video.setAttribute("src", media(href));
        video.dataset.original = href;
        video.setAttribute("controls", "");
        video.setAttribute("preload", "metadata");
        video.setAttribute("playsinline", "");
        element.replaceWith(video);
        continue;
      }
    }
    // Task list checkboxes are shown, never toggled from here.
    if (tag === "input") {
      if (element.getAttribute("type") === "checkbox") {
        element.setAttribute("disabled", "");
      } else {
        element.remove();
      }
    }
    clean(element, base);
  }
}

/** `base`: the lines a previewed suggestion replaces, to show them removed. */
export function sanitize(html: string, base?: string[]): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  clean(root, base);
  return root.innerHTML;
}

/** Whether a picture is in a link to somewhere else (a page, not the picture at full size): a
 *  click follows the link rather than opening the viewer. */
export function leadsElsewhere(img: Element) {
  const href = img.closest("a[href]")?.getAttribute("href");
  return Boolean(href) && !IMAGE_HOSTS.test(href!) && !/\.(png|jpe?g|gif|webp)(\?|$)/iu.test(href!);
}
