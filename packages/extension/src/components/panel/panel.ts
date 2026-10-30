import { i18n } from "#i18n";
import { createBreakdown, type BreakdownRow } from "@/components/breakdown/breakdown";
import { confetti } from "@/components/confetti/confetti";
import { createConversations, type Conversations } from "@/components/conversations/conversations";
import { createFilters, type PanelOption } from "@/components/filters/filters";
import { settingsIcon } from "@/components/icons/icons";
import { createNextFile, type NextFile } from "@/components/next-file/next-file";
import { createStats, type Totals } from "@/components/stats/stats";
import { createTooltip } from "@/components/tooltip/tooltip";
import { createUpdateNotice } from "@/components/update-notice/update-notice";
import { h } from "@/utils/dom/dom";
import { formatDuration, formatNumber as format } from "@/utils/format/format";

export interface PanelContext {
  host: HTMLElement;
  signal: AbortSignal;
  focused: () => HTMLElement | null;
}

export interface PanelActions {
  onToggle: (id: string) => void;
  onSettings: () => void;
  onComment: (step: 1 | -1) => void;
  onNextFile: () => void;
  onUpdateSeen: () => void;
}

export interface Panel {
  renderOptions: (options: PanelOption[], selected: string[]) => void;
  renderStats: (totals: Totals, all?: Totals) => void;
  renderConversations: (conversations: Conversations, most?: number) => void;
  renderNextFile: (next: NextFile) => void;
  renderBreakdown: (rows: () => BreakdownRow[], selected: string[]) => void;
  announce: (summary: Totals & { name: string }) => void;
  announceText: (text: string) => void;
  setVisible: (visible: boolean) => void;
  setCompact: (compact: boolean) => void;
  celebrate: (name: string) => void;
  showUpdate: (version: string | null) => void;
  setTheme: (css: string) => void;
  accent: () => string;
}

interface PanelMount {
  root: ShadowRoot;
  container: HTMLElement;
  host: HTMLElement;
  signal: AbortSignal;
  floating?: boolean | undefined;
}

export const createPanel = (
  { root, container, host, signal, floating = true }: PanelMount,
  { onToggle, onSettings, onComment, onNextFile, onUpdateSeen }: PanelActions,
): Panel => {
  const context: PanelContext = {
    host,
    signal,
    focused: () => (root.activeElement instanceof HTMLElement ? root.activeElement : null),
  };

  const settings = h("button", {
    type: "button",
    className: "settings icon-button",
    onClick: () => {
      onSettings();
    },
  });
  const nextFile = createNextFile(onNextFile);
  const filters = createFilters(context, onToggle);
  const stats = createStats();
  const breakdown = createBreakdown(context, {
    onToggle,
    onOpen: () => {
      conversations.setOpen(false);
    },
    fallback: settings,
  });
  const conversations = createConversations(context, {
    onStep: onComment,
    onOpen: () => {
      breakdown.setOpen(false);
    },
    fallback: settings,
  });
  const update = createUpdateNotice(context, { onSeen: onUpdateSeen, fallback: settings });
  const status = h("span", { className: "visually-hidden", role: "status" });
  const panelElement = h(
    "div",
    { className: "panel" },
    nextFile.element,
    filters.element,
    stats.element,
    breakdown.toggle,
    breakdown.popover,
    conversations.element,
    update.element,
    settings,
    status,
  );
  container.append(panelElement);
  const tooltip = createTooltip(context, container);

  const theme = h("style", { "data-focus-diff-theme": "" });
  root.append(theme);

  let padding = "";
  const reserveScrollRoom = () => {
    if (!floating) return;
    const next = host.style.display === "none" ? "" : `${panelElement.offsetHeight + 32}px`;
    if (next === padding) return;
    padding = next;
    if (next) document.documentElement.style.setProperty("scroll-padding-bottom", next);
    else document.documentElement.style.removeProperty("scroll-padding-bottom");
  };
  signal.addEventListener("abort", () => {
    document.documentElement.style.removeProperty("scroll-padding-bottom");
  });

  const resizeObserver = new ResizeObserver(() => {
    reserveScrollRoom();
    filters.moveIndicator();
    breakdown.reposition();
    conversations.reposition();
  });
  for (const element of [filters.element, breakdown.popover, conversations.popover, panelElement])
    resizeObserver.observe(element);
  signal.addEventListener("abort", () => {
    resizeObserver.disconnect();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (tooltip.isVisible()) tooltip.hide();
      else if (breakdown.isOpen()) breakdown.setOpen(false);
      else if (conversations.isOpen() && context.focused()) conversations.setOpen(false);
    },
    { signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (breakdown.isOpen() && !event.composedPath().includes(host)) breakdown.setOpen(false);
    },
    { signal },
  );

  const renderOptions = (list: PanelOption[], selected: string[]) => {
    if (!filters.render(list, selected)) return;
    const configured = list.length > 1;
    settings.classList.toggle("labelled", !configured);
    breakdown.toggle.hidden = !configured;
    if (configured) {
      settings.replaceChildren(settingsIcon());
      settings.setAttribute("aria-label", i18n.t("panelSettings"));
      settings.dataset.tip = i18n.t("panelSettings");
    } else {
      settings.textContent = i18n.t("panelSetUp");
      settings.removeAttribute("aria-label");
      delete settings.dataset.tip;
      breakdown.setOpen(false);
    }
  };

  const announce = ({ name, visible, total, additions, deletions, pending, minutes }: Totals & { name: string }) => {
    const parts = [
      i18n.t("panelAnnounce", [name, format(visible), format(total), format(additions), format(deletions)]),
      i18n.t("panelAnnounceTime", [formatDuration(minutes).replace(/^~/u, "")]),
    ];
    if (pending > 0) parts.push(i18n.t("panelAnnouncePartial", pending, [format(pending)]));
    status.textContent = parts.join(" ");
  };

  const setCompact = (compact: boolean) => {
    if (host.hasAttribute("data-compact") === compact) return;
    host.toggleAttribute("data-compact", compact);
    requestAnimationFrame(filters.moveIndicator);
  };
  if (floating) {
    const narrow = matchMedia("(max-width: 480px), (max-height: 420px)");
    setCompact(narrow.matches);
    narrow.addEventListener(
      "change",
      () => {
        setCompact(narrow.matches);
      },
      { signal },
    );
  } else host.setAttribute("data-inline", "");

  const setVisible = (visible: boolean) => {
    const display = visible ? "" : "none";
    if (host.style.display === display) return;
    host.style.display = display;
    reserveScrollRoom();
    if (visible) requestAnimationFrame(filters.moveIndicator);
    else {
      tooltip.hide();
      breakdown.setOpen(false);
      conversations.setOpen(false);
    }
  };
  setVisible(false);

  return {
    renderOptions,
    renderStats: stats.render,
    renderNextFile: (next) => {
      nextFile.render(next);
      tooltip.refresh();
    },
    renderConversations: (list, most) => {
      conversations.render(list, most);
      tooltip.refresh();
    },
    renderBreakdown: breakdown.render,
    announce,
    announceText: (text) => {
      status.textContent = text;
    },
    setVisible,
    setCompact,
    showUpdate: update.show,
    setTheme: (css) => {
      if (theme.textContent === css) return;
      theme.textContent = css;
      filters.moveIndicator();
    },
    accent: () => getComputedStyle(host).getPropertyValue("--fd-accent").trim() || "currentColor",
    celebrate: (name) => {
      const box = stats.done.getBoundingClientRect();
      confetti(container, { x: box.left + box.width / 2, y: box.top });
      status.textContent = i18n.t("panelAnnounceDone", [name]);
    },
  };
};
