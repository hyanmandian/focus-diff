// HTML from GitHub (bodyHTML of descriptions and comments) is already sanitized by GitHub. This is a
// second line: only an allowlist of tags and attributes survives, links must be https (or anchors),
// images must come from GitHub's own hosts, and everything else is dropped or unwrapped. The page's
// Content-Security-Policy blocks scripts on top of that.

const TAGS = new Set([
  "a", "b", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "input", "ins", "kbd", "li", "ol", "p", "pre", "s", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "button", "textarea", "select", "svg", "math", "link", "meta", "base", "template", "video", "audio"]);
const ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  input: new Set(["type", "checked", "disabled"]),
  td: new Set(["align", "colspan", "rowspan"]),
  th: new Set(["align", "colspan", "rowspan"]),
  ol: new Set(["start"]),
  details: new Set(["open"]),
};
const IMAGE_HOSTS = /^https:\/\/(?:[\w-]+\.)*(?:githubusercontent\.com|github\.com|githubassets\.com)\//;

function clean(node: Node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP.has(tag)) {
      element.remove();
      continue;
    }
    if (!TAGS.has(tag)) {
      // Keep the text, lose the element.
      clean(element);
      element.replaceWith(...element.childNodes);
      continue;
    }
    const allowed = ATTRIBUTES[tag];
    for (const attribute of [...element.attributes]) {
      if (!allowed?.has(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!/^https:\/\//.test(href)) element.removeAttribute("href");
    }
    if (tag === "img" && !IMAGE_HOSTS.test(element.getAttribute("src") ?? "")) element.remove();
    // Task list checkboxes are shown, never toggled from here.
    if (tag === "input") {
      if (element.getAttribute("type") !== "checkbox") element.remove();
      else element.setAttribute("disabled", "");
    }
    clean(element);
  }
}

export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  clean(root);
  return root.innerHTML;
}
