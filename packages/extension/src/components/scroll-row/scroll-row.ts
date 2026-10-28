import { chevronIcon } from "@/components/icons/icons";
import { h, wheelScrollsSideways } from "@/utils/dom/dom";

/** How far in from either side a row of chips fades out while there's more to scroll to, under an arrow (scroll-row.css). */
export const FADE = 56;

export const scrollBehavior = (): ScrollBehavior =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

/**
 * A row of chips that scrolls sideways when there are more than fit: each side with more fades out under an arrow that
 * scrolls to it, and the mouse wheel scrolls it too, for a mouse without a sideways wheel. The bar's filters and the
 * popup's repositories use it.
 */
export const scrollRow = (element: HTMLElement, signal?: AbortSignal) => {
  // The arrows are for the mouse alone: the keyboard reaches every chip, and a screen reader reads them all, so they
  // stay out of the tab order and the accessibility tree.
  const arrow = (direction: 1 | -1) =>
    h(
      "span",
      {
        className: `scroll-button ${direction > 0 ? "after" : "before"}`,
        "aria-hidden": "true",
        onClick: () => {
          element.scrollBy({ left: direction * (element.clientWidth - FADE * 2), behavior: scrollBehavior() });
        },
      },
      chevronIcon(direction > 0 ? "right" : "left"),
    );
  const row = h("div", { className: "filter-row" }, arrow(-1), element, arrow(1));

  const updateEdges = () => {
    const end = element.scrollWidth - element.clientWidth;
    row.classList.toggle("more-before", element.scrollLeft > 1);
    row.classList.toggle("more-after", element.scrollLeft < end - 1);
  };
  element.addEventListener("scroll", updateEdges, { passive: true, signal });
  wheelScrollsSideways(element, signal);
  return { row, updateEdges };
};

export const placeIndicator = (indicator: HTMLElement, target: HTMLElement, last: HTMLElement): void => {
  const width = last.offsetLeft + last.offsetWidth;
  indicator.style.width = `${width}px`;
  const right = width - target.offsetLeft - target.offsetWidth;
  const bottom = indicator.offsetHeight - target.offsetTop - target.offsetHeight;
  indicator.style.clipPath = `inset(${target.offsetTop}px ${right}px ${bottom}px ${target.offsetLeft}px round 8px)`;
};
