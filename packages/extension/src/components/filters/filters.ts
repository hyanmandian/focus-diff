import { i18n } from "#i18n";
import type { PanelContext } from "@/components/panel/panel";
import { FADE, placeIndicator, scrollBehavior, scrollRow } from "@/components/scroll-row/scroll-row";
import { h } from "@/utils/dom/dom";
import { formatNumber as format } from "@/utils/format/format";

export interface PanelOption {
  id: string;
  name: string;
  count?: number;
  loading?: boolean;
}

const ARROW_STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

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
    if (pressed.length !== 1 || !target?.offsetWidth) return;
    placeIndicator(indicator, target, options().at(-1)!);
    if (!indicator.classList.contains("ready"))
      requestAnimationFrame(() => {
        indicator.classList.add("ready");
      });
  };

  const chipObserver = new ResizeObserver(() => {
    moveIndicator();
  });
  signal.addEventListener("abort", () => {
    chipObserver.disconnect();
  });

  const reveal = (option: HTMLElement) => {
    const left = option.offsetLeft - FADE;
    const right = option.offsetLeft + option.offsetWidth + FADE - element.clientWidth;
    const next = element.scrollLeft > left ? left : element.scrollLeft < right ? right : null;
    if (next !== null) element.scrollTo({ left: next, behavior: scrollBehavior() });
  };

  element.addEventListener("keydown", (event) => {
    const list = options();
    const index = list.findIndex((option) => option === focused());
    if (index === -1) return;
    const target =
      event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : index + (ARROW_STEPS[event.key] ?? Number.NaN);
    if (Number.isNaN(target)) return;
    event.preventDefault();
    const next = list[(target + list.length) % list.length]!;
    list.forEach((option) => {
      option.tabIndex = option === next ? 0 : -1;
    });
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
      options().forEach((option) => {
        option.remove();
      });
      chipObserver.disconnect();
      element.append(
        ...list.map(({ id, name }) => {
          const button = h(
            "button",
            { type: "button", className: "option", "data-id": id },
            h("span", { className: "option-name", textContent: name }),
            h("span", { className: "option-count", "aria-hidden": "true" }),
            h("span", { className: "visually-hidden option-count-label" }),
          );
          button.addEventListener("click", () => {
            if (button.getAttribute("aria-disabled") !== "true") onToggle(id);
          });
          return button;
        }),
      );
      for (const option of options()) chipObserver.observe(option);
      if (keepFocus) requestAnimationFrame(() => element.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
    }

    const current = focused()?.classList.contains("option") ? focused() : null;
    for (const option of options()) {
      const id = option.dataset.id!;
      const item = list.find((each) => each.id === id)!;
      const { count } = item;
      if (count !== undefined) {
        const countElement = option.querySelector(".option-count")!;
        const text = format(count);
        if (countElement.textContent !== text) countElement.textContent = text;
        option.querySelector(".option-count-label")!.textContent = ` ${i18n.t("fileCount", count, [text])}`;
        option.classList.toggle("empty", count === 0);
      }
      const pressed = selected.includes(id);
      if (option.getAttribute("aria-pressed") !== String(pressed)) option.setAttribute("aria-pressed", String(pressed));
      const disabled = count === 0 && !pressed && !item.loading;
      option.setAttribute("aria-disabled", String(disabled));
      if (disabled) {
        const reason = i18n.t("panelFilterEmpty", [item.name]);
        option.dataset.tip = reason;
        option.setAttribute("aria-description", reason);
      } else {
        delete option.dataset.tip;
        option.removeAttribute("aria-description");
      }
      option.tabIndex = (current ? option === current : option.dataset.id === selected[0]) ? 0 : -1;
    }
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
