import type { PanelContext } from "@/components/panel/panel";
import { h } from "@/utils/dom/dom";

const DELAY_MS = 350;
const LINGER_MS = 120;
const GAP = 10;
const SCREEN_MARGIN = 8;
const ARROW_EDGE = 14;

const targetOf = (event: Event) =>
  event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip]") : null;

export const createTooltip = ({ signal }: Pick<PanelContext, "signal">, within: HTMLElement) => {
  const tip = h("div", { className: "tip", "aria-hidden": "true", hidden: true });
  within.append(tip);
  let current: HTMLElement | null = null;
  let showing = 0;
  let hiding = 0;

  const place = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const screen = document.documentElement.clientWidth;
    const left = Math.min(
      Math.max(box.left + box.width / 2 - width / 2, SCREEN_MARGIN),
      screen - SCREEN_MARGIN - width,
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${box.top - height - GAP}px`;
    const arrow = Math.min(Math.max(box.left + box.width / 2 - left, ARROW_EDGE), width - ARROW_EDGE);
    tip.style.setProperty("--fd-tip-arrow-x", `${arrow}px`);
  };

  const show = (target: HTMLElement) => {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    tip.textContent = text;
    tip.hidden = false;
    place(target);
  };

  const hide = () => {
    clearTimeout(showing);
    clearTimeout(hiding);
    current = null;
    tip.hidden = true;
  };

  const open = (target: HTMLElement, delay: number) => {
    hide();
    current = target;
    if (delay)
      showing = window.setTimeout(() => {
        show(target);
      }, delay);
    else show(target);
  };

  within.addEventListener(
    "pointerover",
    (event) => {
      clearTimeout(hiding);
      if (event.target instanceof Node && tip.contains(event.target)) return;
      const target = targetOf(event);
      if (target === current) return;
      if (!target) {
        hide();
        return;
      }
      open(target, "tipInstant" in target.dataset ? 0 : DELAY_MS);
    },
    { signal },
  );
  within.addEventListener(
    "pointerout",
    (event) => {
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!current || current.contains(next) || tip.contains(next)) return;
      clearTimeout(showing);
      hiding = window.setTimeout(hide, LINGER_MS);
    },
    { signal },
  );
  within.addEventListener(
    "focusin",
    (event) => {
      const target = targetOf(event);
      if (target?.matches(":focus-visible")) open(target, 0);
      else hide();
    },
    { signal },
  );
  within.addEventListener("focusout", hide, { signal });
  within.addEventListener(
    "pointerdown",
    (event) => {
      const target = targetOf(event);
      if (!(event.target instanceof Node && tip.contains(event.target)) && !(target && "tipInstant" in target.dataset))
        hide();
    },
    { signal },
  );
  within.addEventListener(
    "click",
    (event) => {
      const target = targetOf(event);
      if (!target || !("tipInstant" in target.dataset)) return;
      if (current === target && !tip.hidden) hide();
      else open(target, 0);
    },
    { signal },
  );

  return {
    hide,
    isVisible: () => !tip.hidden,
    refresh: () => {
      if (current && !tip.hidden) show(current);
    },
  };
};
