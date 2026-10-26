import { browser } from "wxt/browser";

import { i18n } from "#i18n";
import {
  bellIcon,
  clockIcon,
  commentIcon,
  externalIcon,
  pullRequestIcon,
  settingsIcon,
  undoIcon,
} from "@/components/icons/icons";
import { renderReviewPanel } from "@/components/popup-review-time/popup-review-time";
import { FADE, scrollRow } from "@/components/scroll-row/scroll-row";
import { customThemeCss, normalizeAppearance, type Appearance } from "@/utils/appearance/appearance";
import { h } from "@/utils/dom/dom";
import { $, reveal, translateDocument } from "@/utils/extension-page/extension-page";
import { formatDuration } from "@/utils/format/format";
import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { uiLanguage } from "@/utils/i18n/i18n";
import {
  inPopup,
  isDone,
  markDone,
  normalizePopup,
  unmarkDone,
  type DoneMarks,
  type InboxSnapshot,
  type PopupSettings,
  type HeldEvent,
} from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import {
  normalizeReviewTime,
  pullMinutes,
  type FilesRecord,
  type ReviewRun,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";
import { createEstimator, normalizeLearned, PACES, type Learned } from "@/utils/review-time/review-time";
import {
  appearanceItem,
  doneItem,
  heldItem,
  inboxItem,
  learnedItem,
  loadAppearance,
  loadNotify,
  loadPopup,
  loadReviewTime,
  notifyItem,
  popupItem,
  pullFilesItem,
  reviewRunItem,
  reviewSkipItem,
  reviewTimeItem,
} from "@/utils/storage/storage";

import themeCss from "@/components/theme/theme.css?inline";

const comments = (count: number) =>
  h(
    "span",
    { className: "pull-comments" },
    commentIcon(),
    h("span", { "aria-hidden": "true", textContent: String(count) }),
    h("span", { className: "visually-hidden", textContent: i18n.t("popupComments", count, [count]) }),
  );

/** Within a repository: what they were asked to review again first, then what changed since they last looked, then the rest, then drafts. */
const order = (a: PullRequest, b: PullRequest) =>
  Number(a.draft) - Number(b.draft) ||
  Number(Boolean(b.again)) - Number(Boolean(a.again)) ||
  Number(b.unread) - Number(a.unread) ||
  b.updatedAt.localeCompare(a.updatedAt);

const unread = (list: PullRequest[]) => list.filter((pull) => pull.unread).length;

const latest = (list: PullRequest[]) => list.reduce((max, pull) => (pull.updatedAt > max ? pull.updatedAt : max), "");

/** Rows standing in for the lists while the first look is on its way. */
const skeleton = () =>
  h(
    "ul",
    { className: "pulls skeleton", "aria-hidden": "true" },
    ...[0.9, 0.7, 0.8].map((width) =>
      h(
        "li",
        {},
        h(
          "span",
          { className: "pull" },
          h("span", { className: "avatar" }),
          h("span", { className: "pull-body", style: `--w: ${width}` }),
        ),
      ),
    ),
  );

/** The pull requests by repository, the ones with news first, then the most recently active. */
const byRepo = (pulls: PullRequest[]) => {
  const groups = new Map<string, PullRequest[]>();
  for (const pull of pulls) groups.set(pull.repo, [...(groups.get(pull.repo) ?? []), pull]);
  return [...groups]
    .map(([repo, list]) => ({ repo, pulls: list.toSorted(order) }))
    .toSorted((a, b) => unread(b.pulls) - unread(a.pulls) || latest(b.pulls).localeCompare(latest(a.pulls)));
};

/** A repository by its name alone, unless two owners have one by the same name. */
const shortName = (repo: string, all: string[]) => {
  const name = repo.slice(repo.lastIndexOf("/") + 1);
  return all.filter((each) => each.endsWith(`/${name}`)).length > 1 ? repo : name;
};

/**
 * Opens a folded section with its rows unrolling from the top while the list scrolls it up to the top, so what was
 * opened is what's on screen; closing rolls them back up. With reduced motion it opens and scrolls at once.
 */
const unfold = (section: HTMLDetailsElement, body: HTMLElement, open: boolean) => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() || "ease-out";
  for (const animation of body.getAnimations()) animation.cancel();
  if (!open) {
    if (still) return void (section.open = false);
    body.style.overflow = "hidden";
    const closing = body.animate(
      [
        { height: `${body.offsetHeight}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ],
      {
        duration: 200,
        easing: ease,
      },
    );
    closing.onfinish = () => {
      section.open = false;
      body.style.overflow = "";
    };
    return;
  }
  section.open = true;
  const scroller = section.closest<HTMLElement>(".scroll");
  if (scroller) {
    const top = scroller.scrollTop + section.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top, behavior: still ? "auto" : "smooth" });
  }
  if (still) return;
  // The rows are laid out at once, so the list can scroll to them; they're revealed from the top as it does.
  body.animate(
    [
      { clipPath: "inset(0 0 100% 0)", opacity: 0, transform: "translateY(-6px)" },
      { clipPath: "inset(0 0 0 0)", opacity: 1, transform: "none" },
    ],
    { duration: 320, easing: ease },
  );
};

const openOptions = async (section?: string) => {
  const message: Message = { type: "open-options", section };
  await browser.runtime.sendMessage(message);
  window.close();
};

const renderNotify = (enabled: boolean) => {
  const button = $("#notify-setup");
  button.classList.toggle("on", enabled);
  button.replaceChildren(
    bellIcon(),
    h("span", { textContent: i18n.t(enabled ? "popupNotifyOn" : "popupNotifySetup") }),
  );
};

/** The toolbar popup: the reader's pull requests, their review time and the bar's switch. */
export const startPopup = (): void => {
  type List = "reviews" | "mine";
  const LISTS: List[] = ["reviews", "mine"];
  const TAB_KEY = "focus-diff:popup-tab";

  /** The bar's theme, with the reader's own colours over it, on the whole popup instead of the bar's shadow root. */
  const themeStyle = document.createElement("style");
  document.head.append(themeStyle);
  // GitHub's own colours aren't on this page, so only the defaults and the reader's colours apply, without waiting on
  // the provider's stylesheet.
  const restyle = (appearance: Appearance) => {
    const custom = appearance.themes.find((theme) => theme.id === appearance.theme);
    themeStyle.textContent = `${themeCss}\n${custom ? customThemeCss(custom) : ""}`.replaceAll(":host", ":root");
  };
  appearanceItem.watch((value) => {
    restyle(normalizeAppearance(value));
  });

  const language = uiLanguage();
  const relative = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "narrow" });
  const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ];
  /** "3h ago", or "now" under a minute. */
  const ago = (time: number) => {
    const seconds = (time - Date.now()) / 1000;
    const [unit, size] = STEPS.find(([, step]) => Math.abs(seconds) >= step) ?? ["second", 1];
    return unit === "second" ? relative.format(0, "second") : relative.format(Math.round(seconds / size), unit);
  };

  /**
   * The author's picture from GitHub, over their initial in case it doesn't load. One image per author, loaded once: a
   * row drawn again reuses it instead of fetching it again.
   */
  const avatars = new Map<string, HTMLImageElement>();
  /** Authors whose picture went into a row in the drawing under way. */
  const drawnNow = new Set<string>();
  /** Authors whose picture loaded from neither address: they keep their initial. */
  const missingAvatars = new Set<string>();
  const avatar = (login: string) => {
    const slot = h("span", { className: "avatar", "aria-hidden": "true" }, login.charAt(0).toUpperCase());
    if (missingAvatars.has(login)) return slot;
    // GitHub's avatar host by login: it answers at once and the browser keeps it a few minutes, where
    // github.com/<login>.png redirects there on every open, uncached. That one is the fallback.
    const name = encodeURIComponent(login);
    const fallback = `https://github.com/${name}.png?size=48`;
    const picture = (src: string) => {
      const image = h("img", { src, alt: "", width: 24, height: 24 });
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", (event) => {
        if (image.src === fallback) return;
        event.stopImmediatePropagation();
        image.src = fallback;
      });
      return image;
    };
    let image = avatars.get(login);
    if (!image) {
      image = picture(`https://avatars.githubusercontent.com/${name}?size=48`);
      avatars.set(login, image);
    }
    // An image can only be in one place: a second row by the same author, on the page or drawn in the
    // same go (not on the page yet), gets its own, from the address that worked and with the same fallback.
    const placed = image.isConnected || drawnNow.has(login) ? picture(image.src) : image;
    if (drawnNow.size === 0)
      queueMicrotask(() => {
        drawnNow.clear();
      });
    drawnNow.add(login);
    const missing = () => {
      missingAvatars.add(login);
      placed.remove();
    };
    // One that failed while off the page, between two drawings, has no error left to fire.
    if (placed.complete && !placed.naturalWidth) {
      missing();
      return slot;
    }
    placed.addEventListener("error", missing, { once: true });
    slot.append(placed);
    return slot;
  };

  /** Which repositories to list. */
  let popup: PopupSettings = normalizePopup({});

  /** Each pull request's files as last read, and the reader's pace, for how long each on the review queue takes. */
  let pullFiles: Record<string, FilesRecord> = {};
  let learned: Learned | null = null;
  let estimates = new Map<string, number>();
  const reestimate = () => {
    const minutesOf = createEstimator(PACES[reviewTime.pace], reviewTime.learn ? normalizeLearned(learned) : null);
    estimates = new Map(
      (reviewTime.queueEstimates ? (snapshot?.reviews ?? []) : []).flatMap((pull) => {
        const minutes = pullMinutes(pull, pullFiles[pull.url], reviewTime, minutesOf);
        return minutes === null ? [] : [[pull.url, minutes] as const];
      }),
    );
  };

  const estimateOf = (pull: PullRequest) => {
    const minutes = estimates.get(pull.url);
    if (minutes === undefined) return null;
    const text = formatDuration(minutes);
    return h(
      "span",
      { className: "pull-estimate" },
      h("span", { "aria-hidden": "true", textContent: text }),
      // The ~ would be read out as "tilde"; the sentence says "about".
      h("span", { className: "visually-hidden", textContent: i18n.t("popupTakes", [text.replace(/^[~<]/u, "")]) }),
    );
  };

  /** The pull requests marked done, the ones picked to be, and the ones just marked, which Undo takes back. */
  let done: DoneMarks = {};
  const picked: Record<List, Set<string>> = { reviews: new Set(), mine: new Set() };
  let justMarked: PullRequest[] = [];
  type Folded = "drafts" | "done";
  /** Whether each list's folded sections, Drafts and Done, are open, kept across redraws. */
  const foldedOpen: Record<Folded, Record<List, boolean>> = {
    drafts: { reviews: false, mine: false },
    done: { reviews: false, mine: false },
  };

  /**
   * A row: the pull request's link, and over its picture, a checkbox that shows on hover to pick it to mark done, or on a
   * row already done, a button to take it back. The checkbox stays out of the tab order; `x` on a row ticks it.
   */
  const item = (pull: PullRequest, list: List, finished = false) => {
    const showAuthor = list === "reviews" && pull.author;
    const meta = h(
      "span",
      { className: "pull-meta" },
      h("span", { className: "repo-number", textContent: `#${pull.number}` }),
      showAuthor ? h("span", { className: "pull-author", textContent: pull.author }) : null,
      list === "reviews" ? estimateOf(pull) : null,
    );
    // The time and the conversation size stand apart on the right, so the left reads as title, then who.
    const side = h(
      "span",
      { className: "pull-side" },
      pull.updatedAt ? h("span", { className: "pull-time", textContent: ago(Date.parse(pull.updatedAt)) }) : null,
      pull.comments ? comments(pull.comments) : null,
    );
    // A review opens on the files, where the bar is.
    const href = list === "reviews" ? `${pull.url}/changes` : pull.url;
    const classes = ["pull", pull.unread ? "unread" : "", pull.draft ? "draft" : ""].filter(Boolean).join(" ");
    const control = finished ? restoreButton(pull) : pickBox(pull, list);
    const link = h(
      "a",
      { className: classes, href, target: "_blank", rel: "noopener" },
      showAuthor ? avatar(pull.author) : h("span", { className: "avatar", "aria-hidden": "true" }, pullRequestIcon()),
      h(
        "span",
        { className: "pull-body" },
        h("span", { className: "pull-title", textContent: pull.title }),
        h(
          "span",
          { className: "pull-line" },
          meta,
          // On the review queue, drafts sit under their own heading, which says it already.
          pull.draft && list !== "reviews"
            ? h("span", { className: "pull-draft", textContent: i18n.t("popupDraft") })
            : null,
          list === "reviews" && pull.again
            ? h("span", { className: "pull-draft pull-again", textContent: i18n.t("popupAgain") })
            : null,
        ),
        pull.unread ? h("span", { className: "visually-hidden", textContent: i18n.t("popupUnread") }) : null,
      ),
      side,
    );
    if (!finished) link.setAttribute("aria-keyshortcuts", "x");
    const classNames = ["row", finished ? "finished" : "", picked[list].has(pull.url) ? "picked" : ""]
      .filter(Boolean)
      .join(" ");
    return h("li", { className: classNames }, control, link);
  };

  const pickBox = (pull: PullRequest, list: List) => {
    const box = h("input", { type: "checkbox", className: "pick", tabIndex: -1, checked: picked[list].has(pull.url) });
    box.setAttribute("aria-label", i18n.t("popupSelect", [pull.title]));
    box.addEventListener("change", () => {
      if (box.checked) picked[list].add(pull.url);
      else picked[list].delete(pull.url);
      box.closest(".row")?.classList.toggle("picked", box.checked);
      justMarked = [];
      syncSelection();
    });
    return box;
  };

  const restoreButton = (pull: PullRequest) => {
    const button = h(
      "button",
      { type: "button", className: "restore", title: i18n.t("popupNotDone", [pull.title]) },
      undoIcon(),
    );
    button.setAttribute("aria-label", i18n.t("popupNotDone", [pull.title]));
    button.addEventListener("click", () => {
      saveDone(unmarkDone(done, [pull]));
    });
    return button;
  };

  /** The repository each list is narrowed to, if any. */
  const narrowed: Record<List, string> = { reviews: "", mine: "" };

  /** Where each list's chip highlight last was, so a new row of chips slides it on from there. */
  const highlightAt: Record<List, { clip: string; width: string } | null> = { reviews: null, mine: null };

  /**
   * Chips like the bar's filters, to narrow a list to one repository. Only with more than one to pick from. A highlight
   * slides to the chip picked, and the list comes in from its side.
   */
  const repoFilter = (groups: ReturnType<typeof byRepo>, list: List, total: number) => {
    const repos = groups.map((group) => group.repo);
    const repoOrder = ["", ...repos];
    // Taken now: placing the highlight on this row overwrites it.
    const slideFrom = highlightAt[list];
    const chip = (repo: string, label: string, count: number) => {
      const button = h(
        "button",
        { type: "button", className: "chip", title: repo || label },
        h("span", { className: "chip-label", textContent: label }),
        h("span", { className: "option-count", textContent: String(count) }),
      );
      button.setAttribute("aria-pressed", String(narrowed[list] === repo));
      button.addEventListener("click", () => {
        if (narrowed[list] === repo) return;
        const from = repoOrder.indexOf(narrowed[list]);
        narrowed[list] = repo;
        render();
        $(`#panel-${list} .chip[aria-pressed="true"]`).focus();
        slideIn($(`#panel-${list} .groups`), repoOrder.indexOf(repo) > from ? 1 : -1);
      });
      return button;
    };
    const highlight = h("span", { className: "indicator", "aria-hidden": "true" });
    // Where it was, from the first frame, so no chip ever shows unpicked on the way.
    if (slideFrom) Object.assign(highlight.style, { clipPath: slideFrom.clip, width: slideFrom.width });
    const chips = h(
      "div",
      { className: "filters", role: "group" },
      highlight,
      chip("", i18n.t("popupAllRepos"), total),
      ...groups.map((group) => chip(group.repo, shortName(group.repo, repos), group.pulls.length)),
    );
    chips.setAttribute("aria-label", i18n.t("popupRepos"));
    /** The highlight spans every chip, not just the visible part of the row, so it scrolls along with them. */
    const placeHighlight = () => {
      const pressed = chips.querySelector<HTMLElement>('[aria-pressed="true"]');
      const last = chips.querySelector<HTMLElement>(".chip:last-child");
      if (!pressed?.offsetWidth || !last) return;
      const width = last.offsetLeft + last.offsetWidth;
      highlight.style.width = `${width}px`;
      const right = width - pressed.offsetLeft - pressed.offsetWidth;
      const bottom = highlight.offsetHeight - pressed.offsetTop - pressed.offsetHeight;
      highlight.style.clipPath = `inset(${pressed.offsetTop}px ${right}px ${bottom}px ${pressed.offsetLeft}px round 8px)`;
      highlightAt[list] = { clip: highlight.style.clipPath, width: highlight.style.width };
    };
    // The bar's row: arrows and a fade at a side with more chips, and the wheel scrolling it sideways.
    const { row, updateEdges } = scrollRow(chips);
    new ResizeObserver(() => {
      updateEdges();
      placeHighlight();
    }).observe(chips);
    // Drawn again, the row starts at its beginning; the picked chip is brought out from under the fade.
    requestAnimationFrame(() => {
      const pressed = chips.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (pressed && pressed.offsetLeft + pressed.offsetWidth > chips.clientWidth - FADE)
        chips.scrollLeft = pressed.offsetLeft - FADE;
      updateEdges();
      // From where it was on the row before, it slides to the chip picked now.
      if (slideFrom) {
        Object.assign(highlight.style, { clipPath: slideFrom.clip, width: slideFrom.width });
        highlight.getBoundingClientRect();
        highlight.classList.add("ready");
        placeHighlight();
      } else {
        placeHighlight();
        requestAnimationFrame(() => {
          highlight.classList.add("ready");
        });
      }
    });
    return row;
  };

  /**
   * Pull requests folded away at the end: drafts on the review queue, not ready for review yet, and the ones marked done,
   * each with a way back.
   */
  const foldedSection = (kind: Folded, pulls: PullRequest[], list: List) => {
    const doneKind = kind === "done";
    const summary = h(
      "summary",
      {},
      h("span", { textContent: i18n.t(doneKind ? "popupDone" : "popupDrafts") }),
      h("span", { className: "group-count", textContent: String(pulls.length) }),
    );
    const body = h(
      "div",
      { className: "fold-body" },
      h("p", { className: "done-hint", textContent: i18n.t(doneKind ? "popupDoneHint" : "popupDraftsHint") }),
      h("ul", { className: "pulls", role: "list" }, ...pulls.toSorted(order).map((pull) => item(pull, list, doneKind))),
    );
    const section = h("details", { className: "done-section", open: foldedOpen[kind][list] }, summary, body);
    section.addEventListener("toggle", () => {
      foldedOpen[kind][list] = section.open;
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      unfold(section, body, !section.open);
    });
    return section;
  };

  /** On the review queue, drafts aren't ready for review: they wait folded at the end, and no count counts them. */
  const ready = (pulls: PullRequest[], list: List) =>
    list === "reviews" ? pulls.filter((pull) => !pull.draft) : pulls;

  const renderList = (all: PullRequest[], finished: PullRequest[], list: List) => {
    const pulls = ready(all, list);
    const drafts = all.filter((pull) => !pulls.includes(pull));
    const groups = byRepo(pulls);
    if (!groups.some((group) => group.repo === narrowed[list])) narrowed[list] = "";
    const shown = narrowed[list] ? groups.filter((group) => group.repo === narrowed[list]) : groups;
    const sections = shown.map((group) => {
      const rows = h("ul", { className: "pulls", role: "list" }, ...group.pulls.map((pull) => item(pull, list)));
      // With one repository on screen, its name says nothing new; the chip picked says it already.
      if (shown.length === 1) return h("div", { className: "group untitled" }, rows);
      const slash = group.repo.lastIndexOf("/") + 1;
      const id = `${list}-${group.repo.replaceAll(/[^\w-]/gu, "-")}`;
      const section = h(
        "section",
        { className: "group" },
        h(
          "h2",
          { className: "group-title", id },
          h(
            "span",
            { className: "repo-path" },
            h("span", { className: "repo-owner", textContent: group.repo.slice(0, slash) }),
            group.repo.slice(slash),
          ),
          h("span", { className: "group-count", textContent: String(group.pulls.length) }),
        ),
        rows,
      );
      section.setAttribute("aria-labelledby", id);
      return section;
    });
    const inRepo = (each: PullRequest[]) =>
      narrowed[list] ? each.filter((pull) => pull.repo === narrowed[list]) : each;
    if (inRepo(drafts).length > 0) sections.push(foldedSection("drafts", inRepo(drafts), list));
    if (inRepo(finished).length > 0) sections.push(foldedSection("done", inRepo(finished), list));
    return { filter: groups.length > 1 ? repoFilter(groups, list, pulls.length) : null, sections };
  };

  const tabs = LISTS.map((list) => $<HTMLButtonElement>(`#tab-${list}`));
  const panels = LISTS.map((list) => $(`#panel-${list}`));

  /** The pill under the selected tab, which slides to the other one like the bar's does between filters. */
  const indicator = h("span", { className: "tab-indicator", "aria-hidden": "true" });
  $(".tabs").prepend(indicator);
  const moveIndicator = () => {
    const tab = tabs.find((each) => each.getAttribute("aria-selected") === "true");
    if (!tab?.offsetWidth) return;
    indicator.style.setProperty("--left", `${tab.offsetLeft}px`);
    indicator.style.setProperty("--width", `${tab.offsetWidth}px`);
    if (!indicator.classList.contains("ready"))
      requestAnimationFrame(() => {
        indicator.classList.add("ready");
      });
  };
  new ResizeObserver(moveIndicator).observe($(".tabs"));

  /** How far the list coming in travels, from the side of its tab, as the indicator slides there. */
  const SLIDE_PX = 24;

  /** The list coming in slides from its tab's side and fades in, in step with the indicator; with reduced motion it only fades. */
  const slideIn = (panel: HTMLElement, from: 1 | -1) => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() || "ease-out";
    panel.animate(
      [
        { opacity: 0, transform: still ? "none" : `translateX(${from * SLIDE_PX}px)` },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: still ? 120 : 260,
        easing: ease,
      },
    );
  };

  const select = (list: List, focus = false) => {
    const previous = LISTS.findIndex((_, index) => tabs[index]?.getAttribute("aria-selected") === "true");
    const next = LISTS.indexOf(list);
    if (previous !== -1 && previous !== next && panels[next]) slideIn(panels[next], next > previous ? 1 : -1);
    tabs.forEach((tab, index) => {
      const selected = LISTS[index] === list;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, index) => {
      panel.hidden = LISTS[index] !== list;
    });
    moveIndicator();
    syncSelection();
    if (focus) tabs[LISTS.indexOf(list)]?.focus();
    try {
      localStorage.setItem(TAB_KEY, list);
    } catch {
      // Remembering the tab is a nicety.
    }
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      select(LISTS[index]!);
    });
    tab.addEventListener("keydown", (event) => {
      const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: LISTS.length - 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      select(LISTS[(target + LISTS.length) % LISTS.length]!, true);
    });
  });

  // Up and down move between the pull requests, so a long list doesn't take a Tab press per row; `x` picks one to mark
  // done, and Escape lets go of what's picked.
  $("main").addEventListener("keydown", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches("a.pull")) return;
    if (event.key === "x") {
      event.target.closest(".row")?.querySelector<HTMLInputElement>(".pick")?.click();
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && picked[currentList()].size > 0) {
      event.preventDefault();
      clearPicked();
      return;
    }
    const moves: Record<string, (index: number, last: number) => number> = {
      ArrowDown: (index) => index + 1,
      ArrowUp: (index) => index - 1,
      Home: () => 0,
      End: (_, last) => last,
    };
    const move = moves[event.key];
    if (!move) return;
    const rows = [...document.querySelectorAll<HTMLElement>(".list:not([hidden]) a.pull")].filter(
      (each) => each.offsetParent,
    );
    const next = move(rows.indexOf(event.target), rows.length - 1);
    const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
    if (!row) return;
    event.preventDefault();
    row.focus();
  });

  let updating = true;
  let snapshot: InboxSnapshot | null = null;

  const PROBLEMS = { "signed-out": "popupSignedOut", unreadable: "popupUnreadable", offline: "popupOffline" } as const;

  const currentList = (): List => (tabs[1]?.getAttribute("aria-selected") === "true" ? "mine" : "reviews");
  /** The pull requests on each list that aren't done, as last drawn. */
  let active: Record<List, PullRequest[]> = { reviews: [], mine: [] };

  let drawn = "";
  const render = () => {
    const problem = snapshot?.problem ?? null;
    // Only the repositories the reader wants here.
    const shown = (pulls: PullRequest[] = []) => pulls.filter((pull) => inPopup(popup, pull));
    const all: Record<List, PullRequest[]> = { reviews: shown(snapshot?.reviews), mine: shown(snapshot?.mine) };
    const lists: Record<List, PullRequest[]> = {
      reviews: all.reviews.filter((pull) => !isDone(done, pull)),
      mine: all.mine.filter((pull) => !isDone(done, pull)),
    };
    const finished = (list: List) => all[list].filter((pull) => isDone(done, pull));
    active = lists;
    // What's picked and has since gone, done elsewhere or off the list, isn't picked any more.
    for (const list of LISTS)
      for (const url of picked[list]) if (!lists[list].some((pull) => pull.url === url)) picked[list].delete(url);
    const hasLists = all.reviews.length + all.mine.length > 0;
    const loading = updating && !snapshot;
    // Signed out, or with nothing read yet, the problem takes the lists' place; with earlier lists, those stay up under a note.
    const blocking = Boolean(problem) && (problem === "signed-out" || !hasLists);
    // A look that found the same pull requests leaves the rows alone, so nothing flickers or loads again.
    reestimate();
    const key = JSON.stringify([loading, all, narrowed, done, [...estimates], popup]);
    const redraw = key !== drawn;
    drawn = key;
    panels.forEach((panel, index) => {
      const list = LISTS[index]!;
      panel.setAttribute("aria-busy", String(loading));
      if (redraw) {
        const drawnList = loading
          ? { filter: null, sections: [skeleton()] }
          : renderList(lists[list], finished(list), list);
        $(".filter-slot", panel).replaceChildren(...(drawnList.filter ? [drawnList.filter] : []));
        $(".groups", panel).replaceChildren(...drawnList.sections);
      }
      $(".empty", panel).hidden = loading || blocking || lists[list].length > 0;
      $(".see-all", panel).hidden = loading || blocking;
      panel.classList.toggle("blocked", blocking);
      $(`#count-${list}`).textContent = snapshot && !blocking ? String(ready(lists[list], list).length) : "";
    });
    $("#problem").hidden = !blocking;
    $("#notice").hidden = !problem || blocking;
    if (problem) {
      const text = i18n.t(PROBLEMS[problem]);
      $("#problem-text").textContent = text;
      $("#notice-text").textContent = text;
      $("#problem-link").hidden = problem !== "signed-out";
      $("#problem-retry").hidden = problem === "signed-out";
    }
    renderReview();
    // After a failed look, the lists on screen are from the last good one, and it says how old they are.
    $("#updated").textContent = updating
      ? i18n.t("popupUpdating")
      : !snapshot || blocking
        ? ""
        : i18n.t(problem ? "popupListsFrom" : "popupUpdated", [ago(snapshot.checkedAt)]);
  };

  /** The footer while something is picked, or just after marking: how many, and what to do with them. */
  function syncSelection() {
    const list = currentList();
    LISTS.forEach((each, index) => {
      panels[index]?.classList.toggle("selecting", picked[each].size > 0);
    });
    const count = picked[list].size;
    const showing = count > 0 || justMarked.length > 0;
    $("#selection").hidden = !showing;
    $("#updated").hidden = showing;
    $("#notify-setup").hidden = showing;
    $("#selection-text").textContent = count
      ? i18n.t("popupSelected", count, [count])
      : justMarked.length > 0
        ? i18n.t("popupMarked", justMarked.length, [justMarked.length])
        : "";
    $("#selection-clear").hidden = !count;
    $("#mark-done").hidden = !count;
    $("#undo-done").hidden = Boolean(count) || justMarked.length === 0;
  }

  const saveDone = (next: DoneMarks) => {
    done = next;
    void doneItem.setValue(done);
    render();
    syncSelection();
  };

  function clearPicked() {
    picked[currentList()].clear();
    drawn = "";
    render();
    syncSelection();
  }

  let undoTimer = 0;
  $("#mark-done").addEventListener("click", () => {
    const list = currentList();
    justMarked = active[list].filter((pull) => picked[list].has(pull.url));
    picked[list].clear();
    saveDone(markDone(done, justMarked));
    // The rows are gone; the list takes the focus, and Undo stays a few seconds.
    $(`#panel-${list}`).focus();
    clearTimeout(undoTimer);
    undoTimer = window.setTimeout(() => {
      justMarked = [];
      syncSelection();
    }, 6000);
  });
  $("#undo-done").addEventListener("click", () => {
    const back = justMarked;
    justMarked = [];
    saveDone(unmarkDone(done, back));
  });
  $("#selection-clear").addEventListener("click", clearPicked);

  // A pull request opens in a tab behind the popup, which stays open for the next one; only settings close it.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[target="_blank"]') : null;
    if (!link || event.button !== 0) return;
    event.preventDefault();
    // One of review time's opens with its filters on in the bar, which the background sets first.
    if (link.dataset.repo && link.dataset.url) {
      const message: Message = { type: "review-open", url: link.dataset.url, repo: link.dataset.repo };
      void browser.runtime.sendMessage(message);
      return;
    }
    void browser.tabs.create({ url: link.href, active: false });
    // GitHub counts it as seen once it opens.
    link.classList.remove("unread");
  });

  const refresh = () => {
    updating = true;
    render();
    const message: Message = { type: "inbox-refresh" };
    void browser.runtime
      .sendMessage(message)
      .catch(() => {})
      .finally(() => {
        updating = false;
        render();
      });
  };

  const settings = $("#settings");
  settings.append(settingsIcon());
  settings.title = i18n.t("panelSettings");
  settings.addEventListener("click", () => void openOptions());
  $("#notify-setup").addEventListener("click", () => void openOptions("notifications"));
  document.querySelectorAll(".retry").forEach((button) => {
    button.addEventListener("click", refresh);
  });
  document.querySelectorAll(".see-all").forEach((link) => {
    link.append(externalIcon());
  });

  translateDocument(i18n.t("popupTitle"));
  let initial: List = "reviews";
  try {
    initial = localStorage.getItem(TAB_KEY) === "mine" ? "mine" : "reviews";
  } catch {
    // As above.
  }
  select(initial);

  /**
   * Review time: set up once in settings, it keeps out of the way. Its card shows over the lists only while one is
   * offered or under way, or when the reader asks to review now, with the clock button.
   */
  let reviewTime: ReviewTimeSettings = normalizeReviewTime({});
  let run: ReviewRun | null = null;
  let held: HeldEvent[] = [];
  let reviewingNow = false;
  let skipUntil = 0;
  const reviewCard = $("#review-card");
  const reviewNow = $("#review-now");
  reviewNow.append(clockIcon());
  reviewNow.title = i18n.t("popupReviewNow");
  reviewNow.setAttribute("aria-label", i18n.t("popupReviewNow"));
  reviewNow.addEventListener("click", () => {
    reviewingNow = !reviewingNow;
    renderReview();
    if (reviewingNow) reviewCard.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  });
  // Escape puts the review now form away, back on the clock.
  reviewCard.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || run || !reviewingNow) return;
    event.preventDefault();
    reviewingNow = false;
    renderReview();
    reviewNow.focus();
  });
  function renderReview() {
    const waiting = new Set((snapshot?.reviews ?? []).filter((pull) => !isDone(done, pull)).map((pull) => pull.url));
    // Once one starts, the card shows it; asking to review now again starts from the form.
    if (run) reviewingNow = false;
    reviewCard.hidden = !run && !reviewingNow;
    reviewNow.hidden = Boolean(run);
    reviewNow.setAttribute("aria-expanded", String(reviewingNow));
    // What's kept for review time shows on the clock, so it can be looked at before one comes.
    const kept = held.filter((event) => event.until === "review").length;
    reviewNow.dataset.count = kept ? String(kept) : "";
    reviewNow.setAttribute("aria-label", kept ? i18n.t("popupReviewNowHeld", kept, [kept]) : i18n.t("popupReviewNow"));
    if (reviewCard.hidden) {
      reviewCard.replaceChildren();
      return;
    }
    renderReviewPanel(
      reviewCard,
      { settings: reviewTime, run, waiting, held, skipUntil },
      {
        avatar,
        openOptions: (section) => void openOptions(section),
        skip: (until) => void reviewSkipItem.setValue(until),
        close: () => {
          reviewingNow = false;
          renderReview();
          reviewNow.focus();
        },
      },
      renderReview,
    );
  }
  // The time left goes down while the popup is open.
  setInterval(() => {
    if (run?.startedAt) renderReview();
  }, 20_000);
  reviewRunItem.watch((value) => {
    run = value;
    renderReview();
  });
  heldItem.watch((value) => {
    held = value;
    renderReview();
  });
  reviewTimeItem.watch((value) => {
    reviewTime = normalizeReviewTime(value);
    renderReview();
    render();
  });
  popupItem.watch((value) => {
    popup = normalizePopup(value);
    render();
  });
  pullFilesItem.watch((value) => {
    pullFiles = value;
    render();
  });
  learnedItem.watch((value) => {
    learned = value;
    render();
  });
  reviewSkipItem.watch((value) => {
    skipUntil = value;
    renderReview();
  });

  inboxItem.watch((value) => {
    snapshot = value;
    render();
  });
  notifyItem.watch(
    () =>
      void loadNotify().then((notify) => {
        renderNotify(notify.enabled);
      }),
  );
  doneItem.watch((value) => {
    done = value;
    render();
    syncSelection();
  });
  void Promise.all([
    inboxItem.getValue(),
    loadNotify(),
    doneItem.getValue(),
    loadReviewTime(),
    reviewRunItem.getValue(),
    heldItem.getValue(),
    reviewSkipItem.getValue(),
    pullFilesItem.getValue(),
    learnedItem.getValue(),
    loadPopup(),
    loadAppearance().then(restyle),
  ]).then(([value, notify, marks, savedReviewTime, current, kept, skipping, files, pace, repos]) => {
    popup = repos;
    skipUntil = skipping;
    pullFiles = files;
    learned = pace;
    snapshot = value;
    done = marks;
    reviewTime = savedReviewTime;
    run = current;
    held = kept;
    renderNotify(notify.enabled);
    render();
    reveal();
    refresh();
  });
};
