import { toMatcher } from "@focus-diff/core/filters";

import { i18n } from "#i18n";
import { commentIcon } from "@/components/icons/icons";
import { createPanel } from "@/components/panel/panel";
import { createTooltip } from "@/components/tooltip/tooltip";
import type { DemoFile, DemoPullRequest } from "@/utils/demo-sample/demo-sample";
import { h } from "@/utils/dom/dom";
import { ALL } from "@/utils/filters/filters";
import { formatNumber as format } from "@/utils/format/format";
import { message } from "@/utils/i18n/i18n";
import { createReviewView, nextFilterWithWork, review, stepFrom, toggled, type Option } from "@/utils/review/review";

import demoStyles from "./demo.css?inline";
import themeStyles from "@/components/theme/theme.css?inline";
import tooltipStyles from "@/components/tooltip/tooltip.css?inline";

const componentStyles = Object.values(
  import.meta.glob<string>(["../**/*.css", "!./**"], { query: "?inline", import: "default", eager: true }),
);

const sheet = (css: string) => {
  const style = new CSSStyleSheet();
  style.replaceSync(css);
  return style;
};

export interface DemoOptions {
  onSettings: () => void;
  theme: string;
}

export interface Demo {
  setTheme: (css: string) => void;
}

export const createDemo = (
  target: HTMLElement,
  pullRequest: DemoPullRequest,
  { onSettings, theme }: DemoOptions,
): Demo => {
  const controller = new AbortController();
  const root = target.shadowRoot ?? target.attachShadow({ mode: "open" });
  const themeSheet = sheet(theme);
  root.adoptedStyleSheets = [sheet(themeStyles), sheet(tooltipStyles), sheet(demoStyles), themeSheet];

  const filters: Option[] = pullRequest.filters.flatMap((filter) => {
    const matches = toMatcher(filter);
    return matches ? [{ id: filter.id, name: message(filter.name), matches }] : [];
  });
  const options: Option[] = [{ id: ALL, name: i18n.t("filterAll") }, ...filters];
  const files = pullRequest.files.map((file: DemoFile) => ({
    ...file,
    stats: { additions: file.additions, deletions: file.deletions },
    viewed: Boolean(file.viewed),
  }));
  type File = (typeof files)[number];

  let ids: string[] = [];
  let shown: File[] = files;
  let current: File | null = null;
  let conversation = 0;

  const conversationsIn = (list: File[]) =>
    list.flatMap((file) => (file.conversations ?? []).map(({ line, state }) => ({ path: file.path, line, state })));

  const rows = new Map(
    files.map((file, index) => {
      const pathId = `demo-path-${index}`;
      const toggleId = `demo-viewed-${index}`;
      const outsideId = `demo-outside-${index}`;
      const viewed = h(
        "button",
        {
          type: "button",
          id: toggleId,
          className: "demo-viewed",
          "aria-pressed": String(file.viewed),
          "aria-labelledby": `${toggleId} ${pathId}`,
          "aria-describedby": outsideId,
          onClick: () => {
            if (viewed.getAttribute("aria-disabled") === "true") return;
            file.viewed = !file.viewed;
            viewed.setAttribute("aria-pressed", String(file.viewed));
            apply();
          },
        },
        i18n.t("demoViewed"),
      );
      const talks = (file.conversations ?? []).map(({ line }) =>
        h("span", { className: "demo-talk", "data-line": String(line) }, commentIcon(), `L${format(line)}`),
      );
      const row = h(
        "li",
        { className: "demo-file" },
        h("span", { className: "demo-path", id: pathId, textContent: file.path }),
        h("span", { className: "visually-hidden", id: outsideId }),
        talks.length > 0 ? h("span", { className: "demo-talks", "aria-hidden": "true" }, ...talks) : null,
        h(
          "span",
          { className: "demo-lines" },
          h("span", { className: "demo-add", textContent: `+${format(file.additions)}` }),
          h("span", { className: "demo-del", textContent: `−${format(file.deletions)}` }),
        ),
        viewed,
      );
      return [file, row] as const;
    }),
  );

  const host = h("div", { className: "demo-bar" });
  const panelRoot = host.attachShadow({ mode: "open" });
  const container = h("div");
  panelRoot.append(h("style", { textContent: componentStyles.join("\n") }), container);
  const list = h("ul", { className: "demo-files" }, ...rows.values());
  root.replaceChildren(h("div", { className: "demo", role: "group", "aria-label": i18n.t("demoLabel") }, list, host));

  const goTo = (file: File | null) => {
    current = file;
    for (const [each, row] of rows) {
      if (each === file) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (file) rows.get(file)!.scrollIntoView({ block: "nearest", behavior: reduce ? "instant" : "smooth" });
  };

  const panel = createPanel(
    { root: panelRoot, container, host, signal: controller.signal, floating: false },
    {
      onToggle: (id) => {
        choose(toggled(ids, id));
      },
      onSettings,
      onNextFile: () => {
        nextFile();
      },
      onComment: (direction) => {
        const threads = conversationsIn(shown);
        if (threads.length === 0) return;
        const index = stepFrom(conversation, direction, threads.length);
        conversation = index + 1;
        const { path } = threads[index]!;
        goTo(shown.find((file) => file.path === path)!);
        apply();
        panel.announceText(i18n.t("panelJumpedToComment", [String(conversation), String(threads.length), path]));
      },
      onUpdateSeen: () => {},
    },
  );
  const showReview = createReviewView(panel);
  const tooltip = createTooltip({ signal: controller.signal }, list);
  root.addEventListener(
    "keydown",
    (event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") tooltip.hide();
    },
    {
      signal: controller.signal,
    },
  );

  function apply(announce = false) {
    const now = review({ list: files, complete: true }, options, ids);
    shown = now.shown;
    const conversations = conversationsIn(shown);
    const at = conversations[conversation - 1];
    const outside = now.filtering ? i18n.t("demoOutside", [now.name]) : "";
    for (const [file, row] of rows) {
      const out = !now.matches(file.path);
      row.toggleAttribute("data-out", out);
      const toggle = row.querySelector<HTMLElement>(".demo-viewed")!;
      toggle.setAttribute("aria-disabled", String(out));
      if (out) toggle.dataset.tip = outside;
      else delete toggle.dataset.tip;
      row.querySelector(".visually-hidden")!.textContent = out ? outside : "";
      for (const talk of row.querySelectorAll<HTMLElement>(".demo-talk"))
        talk.toggleAttribute("data-current", file.path === at?.path && talk.dataset.line === String(at.line));
    }
    panel.renderConversations(
      { list: conversations, current: conversation },
      now.filtering ? conversationsIn(files).length : undefined,
    );
    showReview(now, now.selection.join(), { announce });
  }

  function choose(next: string[]) {
    ids = next;
    conversation = 0;
    apply(true);
    goTo(shown.find((file) => !file.viewed) ?? null);
  }

  function nextFile() {
    const left = shown.filter((file) => !file.viewed);
    if (left.length === 0) {
      choose([nextFilterWithWork(files, filters, ids)!.id]);
      return;
    }
    const from = current ? shown.indexOf(current) : -1;
    const upNext = left.find((file) => shown.indexOf(file) > from) ?? left[0]!;
    goTo(upNext);
    panel.announceText(i18n.t("panelJumpedToFile", left.length, [upNext.path, format(left.length)]));
  }

  const fit = () => {
    const bar = container.querySelector(".panel")!;
    panel.setCompact(false);
    const room = { "--fd-max-width": "none", width: "max-content", "max-width": "none" };
    for (const [name, value] of Object.entries(room)) host.style.setProperty(name, value);
    const needed = bar.getBoundingClientRect().width;
    for (const name of Object.keys(room)) host.style.removeProperty(name);
    panel.setCompact(needed > list.clientWidth);
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(list);

  apply();
  panel.setTheme(theme);
  panel.setVisible(true);
  fit();
  return {
    setTheme: (css) => {
      themeSheet.replaceSync(css);
      panel.setTheme(css);
    },
  };
};
