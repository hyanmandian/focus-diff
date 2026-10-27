import { moreIcon } from "@/components/icons/icons";
import { h } from "@/utils/dom/dom";

/** Something to do from a row's menu. */
export interface MenuAction {
  label: string;
  run: () => void;
}

/** The gap between the button and its menu. */
const GAP = 4;
/** How close to the window's edge the menu may come. */
const MARGIN = 8;

let opened = 0;

/**
 * A row's menu: a button with three dots that opens a short list of actions under it, or over it near the window's
 * bottom. It works like a native menu: the arrow keys, Home and End move between the actions, Enter or a click runs one,
 * and Escape, Tab, a click elsewhere or a scroll that moves its row closes it, which `onClose` hears of. The menu is drawn in the row, so it
 * goes with the row when the list is drawn again, and fixed to the window, so the list's scrolling pane doesn't cut it
 * off.
 */
export const rowMenu = (label: string, actions: MenuAction[], onClose: () => void = () => {}): HTMLElement => {
  opened += 1;
  const id = `row-menu-${opened}`;
  const button = h(
    "button",
    { type: "button", className: "row-menu", title: label, "aria-haspopup": "menu", "aria-expanded": "false" },
    moreIcon(),
  );
  button.setAttribute("aria-label", label);
  const items = actions.map((action) =>
    h("button", { type: "button", role: "menuitem", className: "menu-item", tabIndex: -1, textContent: action.label }),
  );
  const menu = h("div", { className: "menu", role: "menu", id, hidden: true }, ...items);
  menu.setAttribute("aria-label", label);
  button.setAttribute("aria-controls", id);

  const away = (event: Event) => {
    const path = event.composedPath();
    if (!path.includes(menu) && !path.includes(button)) close(false);
  };
  /** Where the button was as the menu opened: a scroll that moves it takes the menu away from its row. */
  let openedAt = 0;
  const scrolled = () => {
    if (button.getBoundingClientRect().top !== openedAt) close(false);
  };
  function close(refocus: boolean) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("scroll", scrolled, true);
    if (refocus) button.focus();
    onClose();
  }
  const open = (focus: number) => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const at = button.getBoundingClientRect();
    openedAt = at.top;
    const below = at.bottom + GAP + menu.offsetHeight <= innerHeight - MARGIN;
    Object.assign(menu.style, {
      top: `${below ? at.bottom + GAP : Math.max(MARGIN, at.top - GAP - menu.offsetHeight)}px`,
      right: `${Math.max(MARGIN, innerWidth - at.right)}px`,
    });
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", scrolled, true);
    // Not scrolled to: fixed to the window, it's in sight already, and a scroll would close it.
    items.at(focus)?.focus({ preventScroll: true });
  };

  button.addEventListener("click", () => {
    if (menu.hidden) open(0);
    else close(true);
  });
  button.addEventListener("keydown", (event) => {
    const focus = { ArrowDown: 0, ArrowUp: -1 }[event.key];
    if (focus === undefined) return;
    event.preventDefault();
    open(focus);
  });
  items.forEach((item, index) => {
    item.addEventListener("click", () => {
      close(true);
      actions[index]?.run();
    });
  });
  menu.addEventListener("keydown", (event) => {
    const index = items.findIndex((item) => item === document.activeElement);
    const last = items.length - 1;
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: last }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      items[(target + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (event.key === "Escape") {
      // Only the menu closes, not the popup around it.
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // Back on the button, Tab goes on from there.
      close(true);
    }
  });
  return h("div", { className: "row-menu-slot" }, button, menu);
};
