import { i18n } from "#i18n";
import type { PanelContext } from "@/components/panel/panel";
import { FADE, scrollBehavior, scrollRow } from "@/components/scroll-row/scroll-row";
import { h } from "@/utils/dom/dom";
import { formatNumber as format } from "@/utils/format/format";

export interface PanelOption {
  id: string;
  name: string;
  /** Files this option shows. */
  count?: number;
  /** Files the site hasn't loaded yet might add to the count, so none isn't final. */
  loading?: boolean;
}

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The filter chips: one roving tab stop, arrow keys between chips, and a highlight that slides to the pressed one.
 * `render` returns true when the list of filters itself changed.
 */
export const createFilters = ({ focused, signal }: PanelContext, onToggle: (id: string) => void) => {
  const indicator = h("span", { className: "indicator", "aria-hidden": "true" });
  const element = h(
    "div",
    { className: "filters", role: "toolbar", "aria-label": i18n.t("panelShowFiles") },
    indicator,
  );
  const options = () => [...element.querySelectorAll<HTMLButtonElement>(".option")];

  const { row, updateEdges } = scrollRow(element, signal);

  const moveIndicator = () => {
    updateEdges();
    const pressed = element.querySelectorAll<HTMLElement>('[aria-pressed="true"]');
    element.classList.toggle("combined", pressed.length > 1);
    const target = pressed[0];
    const last = options().at(-1);
    if (pressed.length !== 1 || !target?.offsetWidth || !last) return;
    // The indicator spans every chip, not just the visible part of the row, so it scrolls along with them.
    const width = last.offsetLeft + last.offsetWidth;
    indicator.style.width = `${width}px`;
    const right = width - target.offsetLeft - target.offsetWidth;
    const bottom = indicator.offsetHeight - target.offsetTop - target.offsetHeight;
    indicator.style.clipPath = `inset(${target.offsetTop}px ${right}px ${bottom}px ${target.offsetLeft}px round 8px)`;
    if (!indicator.classList.contains("ready")) requestAnimationFrame(() => indicator.classList.add("ready"));
  };

  /** Chips change width as their counts come in, which moves the ones after them without resizing a full row. */
  const chipObserver = new ResizeObserver(() => moveIndicator());
  signal.addEventListener("abort", () => chipObserver.disconnect());

  /** Scrolls the row just enough to show a chip whole, past the fade at either side. */
  const reveal = (option: HTMLElement) => {
    const left = option.offsetLeft - FADE;
    const right = option.offsetLeft + option.offsetWidth + FADE - element.clientWidth;
    const next = element.scrollLeft > left ? left : element.scrollLeft < right ? right : null;
    if (next !== null) element.scrollTo({ left: next, behavior: scrollBehavior() });
  };

  element.addEventListener("keydown", (event) => {
    const list = options();
    const index = list.indexOf(focused() as HTMLButtonElement);
    if (index === -1) return;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : index + (ARROW_STEPS[event.key] ?? Number.NaN);
    if (Number.isNaN(target)) return;
    event.preventDefault();
    const next = list[(target + list.length) % list.length];
    if (!next) return;
    list.forEach((option) => (option.tabIndex = option === next ? 0 : -1));
    next.focus();
  });

  let optionsKey = "";
  let indicatorKey = "";
  const render = (list: PanelOption[], selected: string[]): boolean => {
    const key = JSON.stringify(list.map(({ id, name }) => [id, name]));
    const changed = key !== optionsKey;
    if (changed) {
      optionsKey = key;
      const keepFocus = element.contains(focused());
      options().forEach((option) => option.remove());
      chipObserver.disconnect();
      element.append(
        ...list.map(({ id, name }) =>
          h(
            "button",
            {
              type: "button",
              className: "option",
              "data-id": id,
              onClick: (event: MouseEvent) => {
                if ((event.currentTarget as HTMLElement).getAttribute("aria-disabled") !== "true") onToggle(id);
              },
            },
            h("span", { className: "option-name", textContent: name }),
            h("span", { className: "option-count", "aria-hidden": "true" }),
            h("span", { className: "visually-hidden option-count-label" }),
          ),
        ),
      );
      for (const option of options()) chipObserver.observe(option);
      if (keepFocus) requestAnimationFrame(() => element.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
    }

    const current = focused()?.classList.contains("option") ? focused() : null;
    for (const option of options()) {
      const item = list.find(({ id }) => id === option.dataset.id);
      const count = item?.count;
      const countElement = option.querySelector(".option-count");
      const countLabel = option.querySelector(".option-count-label");
      if (countElement && countLabel && count !== undefined) {
        const text = format(count);
        if (countElement.textContent !== text) countElement.textContent = text;
        countLabel.textContent = ` ${i18n.t("fileCount", count, [text])}`;
        option.classList.toggle("empty", count === 0);
      }
      const pressed = selected.includes(option.dataset.id ?? "");
      if (option.getAttribute("aria-pressed") !== String(pressed)) option.setAttribute("aria-pressed", String(pressed));
      // A filter with nothing to show can't be picked, and says why; one already on can still be turned off.
      const disabled = count === 0 && !pressed && !item?.loading;
      option.setAttribute("aria-disabled", String(disabled));
      // The reason shows as a tooltip and is read out as the chip's description.
      const reason = disabled && item ? i18n.t("panelFilterEmpty", [item.name]) : "";
      if (reason) {
        option.dataset.tip = reason;
        option.setAttribute("aria-description", reason);
      } else {
        delete option.dataset.tip;
        option.removeAttribute("aria-description");
      }
      option.tabIndex = (current ? option === current : option.dataset.id === selected[0]) ? 0 : -1;
    }
    // Measuring the chips forces a layout, so it only happens when the selection changes; a ResizeObserver covers the rest.
    const pressedKey = `${optionsKey} ${selected.join()}`;
    if (pressedKey !== indicatorKey) {
      indicatorKey = pressedKey;
      moveIndicator();
      const first = element.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (first) reveal(first);
    }
    return changed;
  };

  return { element: row, render, moveIndicator };
};
