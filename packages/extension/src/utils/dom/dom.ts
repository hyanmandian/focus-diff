type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on") && typeof value === "function")
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an on* prop is a listener for its event.
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key.includes("-") || key === "role") element.setAttribute(key, String(value));
    else Reflect.set(element, key, value);
  }
  element.append(...children.filter((child): child is Node | string => Boolean(child) || child === ""));
  return element;
};

const SVG = "http://www.w3.org/2000/svg";

type Shape = [tag: "path" | "circle", attributes: Record<string, string>];

export const icon = (shapes: string | Shape[], size = 16): SVGSVGElement => {
  const svg = document.createElementNS(SVG, "svg");
  const attributes = {
    viewBox: "0 0 16 16",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  };
  Object.entries(attributes).forEach(([name, value]) => {
    svg.setAttribute(name, value);
  });
  const list: Shape[] = typeof shapes === "string" ? [["path", { d: shapes }]] : shapes;
  for (const [tag, shapeAttributes] of list) {
    const shape = document.createElementNS(SVG, tag);
    Object.entries(shapeAttributes).forEach(([name, value]) => {
      shape.setAttribute(name, value);
    });
    svg.append(shape);
  }
  return svg;
};

export const wheelScrollsSideways = (element: HTMLElement, signal?: AbortSignal): void => {
  element.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const end = element.scrollWidth - element.clientWidth;
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const next = Math.min(end, Math.max(0, element.scrollLeft + delta));
      if (end <= 0 || next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    },
    { passive: false, signal },
  );
};

export const cloneOf = <T extends Node>(node: T, deep = true): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cloneNode returns a Node; a copy is of the node's own kind.
  node.cloneNode(deep) as T;
