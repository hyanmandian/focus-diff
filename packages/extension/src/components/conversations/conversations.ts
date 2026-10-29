import { i18n } from "#i18n";
import { chevronIcon, commentIcon, targetIcon, threadStateIcons } from "@/components/icons/icons";
import type { PanelContext } from "@/components/panel/panel";
import { centreOver, returnFocus } from "@/components/popover/popover";
import { h } from "@/utils/dom/dom";
import { formatNumber as format } from "@/utils/format/format";
import type { ThreadState } from "@/utils/provider/provider";

export interface Conversation {
  path: string;
  line: number | null;
  state: ThreadState;
}

export interface Conversations {
  list: Conversation[];
  current: number;
}

interface ConversationActions {
  onStep: (direction: 1 | -1) => void;
  onOpen: () => void;
  fallback: HTMLElement;
}

const STATE_LABEL = {
  waiting: "panelStateWaiting",
  answered: "panelStateAnswered",
  resolved: "panelStateResolved",
} as const;

export const createConversations = (
  { host, focused }: PanelContext,
  { onStep, onOpen, fallback }: ConversationActions,
) => {
  const count = h("span", { className: "option-count", "aria-hidden": "true" });
  const toggle = h(
    "button",
    { type: "button", className: "comments", "aria-expanded": "false", "aria-controls": "focus-diff-conversations" },
    h("span", { className: "comments-icon", "aria-hidden": "true" }, commentIcon()),
    count,
  );
  const icon = h("span", { className: "conversation-icon", "aria-hidden": "true" });
  const file = h("span", { className: "conversation-file" });
  const state = h("span", { className: "conversation-state" });
  const position = h("span", { className: "conversation-position", "aria-hidden": "true" });
  const step = (direction: 1 | -1) => {
    const label = i18n.t(direction > 0 ? "panelNextComment" : "panelPreviousComment");
    return h(
      "button",
      {
        type: "button",
        className: "icon-button step",
        "aria-label": label,
        "data-tip": label,
        onClick: () => {
          onStep(direction);
        },
      },
      chevronIcon(direction > 0 ? "right" : "left"),
    );
  };
  const next = step(1);
  const goTo = h(
    "button",
    {
      type: "button",
      className: "icon-button go-to",
      "aria-label": i18n.t("panelGoToComment"),
      "data-tip": i18n.t("panelGoToComment"),
      onClick: () => {
        onStep(1);
      },
    },
    targetIcon(),
  );
  const popover = h(
    "div",
    {
      className: "conversations popover",
      id: "focus-diff-conversations",
      role: "dialog",
      "aria-label": i18n.t("panelComments"),
      hidden: true,
    },
    icon,
    file,
    state,
    position,
    h("span", { className: "conversation-steps" }, step(-1), next, goTo),
  );
  const element = h("div", { className: "navigation" }, toggle, popover);

  let source: Conversations = { current: 0, list: [] };

  const draw = () => {
    if (popover.hidden) return;
    const { current, list } = source;
    const target = list[current - 1] ?? list[0];
    if (!target) return;
    const name = target.path.slice(target.path.lastIndexOf("/") + 1);
    file.replaceChildren(
      h("span", { className: "conversation-name", textContent: name }),
      target.line ? h("span", { className: "conversation-line", textContent: `:${format(target.line)}` }) : "",
    );
    file.dataset.tip = target.path;
    if (popover.dataset.state !== target.state) {
      popover.dataset.state = target.state;
      icon.replaceChildren(threadStateIcons[target.state]());
    }
    state.textContent = i18n.t(STATE_LABEL[target.state]);
    const single = list.length === 1;
    if (single !== popover.hasAttribute("data-single")) {
      const had = focused();
      popover.toggleAttribute("data-single", single);
      if (had && popover.contains(had) && had.matches(".step, .go-to")) (single ? goTo : next).focus();
    }
    position.textContent = `${format(Math.max(current, 1))}/${format(list.length)}`;
  };

  const reposition = () => {
    centreOver(popover, toggle, host);
  };

  const setOpen = (open: boolean) => {
    if (popover.hidden === !open) return;
    if (!open) returnFocus(popover, toggle, fallback, focused());
    popover.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      onOpen();
      if (source.current === 0) onStep(1);
      draw();
      reposition();
    }
  };
  const isOpen = () => !popover.hidden;
  toggle.addEventListener("click", () => {
    if (source.list.length > 0) setOpen(!isOpen());
  });

  const render = (conversations: Conversations, most = conversations.list.length) => {
    const total = conversations.list.length;
    toggle.setAttribute("aria-disabled", String(total === 0));
    toggle.dataset.tip = total === 0 ? i18n.t("panelNoComments") : i18n.t("panelComments");
    if (!total) setOpen(false);
    count.textContent = format(total);
    count.style.minWidth = `calc(${format(Math.max(most, total)).length}ch + 12px)`;
    const where = total ? i18n.t("panelCommentCount", total, [format(total)]) : i18n.t("panelNoComments");
    toggle.setAttribute("aria-label", `${i18n.t("panelComments")}, ${where}`);
    source = conversations;
    draw();
  };

  return { element, popover, render, setOpen, reposition, isOpen };
};
