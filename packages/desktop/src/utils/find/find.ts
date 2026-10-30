import { patchLines } from "@/utils/patch/patch";

type Side = "additions" | "deletions";

export type FindMatch = { path: string; side: Side; line: number; nth: number };

export function findInPatches(files: Array<{ path: string; patch: string }>, query: string): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle.trim()) return [];
  const matches: FindMatch[] = [];
  for (const file of files) {
    for (const { text, kind, old, now } of patchLines(file.patch)) {
      const side: Side = kind === "-" ? "deletions" : "additions";
      const line = side === "deletions" ? old : now;
      const code = text.slice(1).toLowerCase();
      let nth = 0;
      for (let at = code.indexOf(needle); at !== -1; at = code.indexOf(needle, at + needle.length))
        matches.push({ path: file.path, side, line, nth: nth++ });
    }
  }
  return matches;
}

function textNodes(element: Element) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

export function rangesIn(element: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle.trim()) return [];
  const nodes = textNodes(element);
  const starts: number[] = [];
  let text = "";
  for (const node of nodes) {
    starts.push(text.length);
    text += String(node.nodeValue);
  }
  text = text.toLowerCase();
  const at = (offset: number, end: boolean): [Node, number] => {
    const index = starts.findLastIndex((start) => (end ? start < offset : start <= offset));
    return [nodes[index]!, offset - starts[index]!];
  };
  const ranges: Range[] = [];
  for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + needle.length)) {
    const range = element.ownerDocument.createRange();
    range.setStart(...at(start, false));
    range.setEnd(...at(start + needle.length, true));
    ranges.push(range);
  }
  return ranges;
}
