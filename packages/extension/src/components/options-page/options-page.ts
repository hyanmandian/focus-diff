import { compile, toMatcher } from "@focus-diff/core/filters";
import { repoMatches } from "@focus-diff/core/repos";
import { browser } from "wxt/browser";

import { i18n } from "#i18n";
import { createLook } from "@/components/options-look/options-look";
import { createNotifications } from "@/components/options-notifications/options-notifications";
import { createPopupSettings } from "@/components/options-popup-settings/options-popup-settings";
import { createReviewTime } from "@/components/options-review-time/options-review-time";
import { copyOrShow } from "@/components/options-widgets/options-widgets";
import { toaster } from "@/components/toast/toast";
import { normalizeAppearance } from "@/utils/appearance/appearance";
import { $, reveal, templateElement, translate, translateDocument } from "@/utils/extension-page/extension-page";
import {
  filtersFor,
  isEmpty,
  newId,
  normalize,
  REPO_PATTERN,
  type Config,
  type Filter,
  type RepoFilters,
} from "@/utils/filters/filters";
import { uiLanguage } from "@/utils/i18n/i18n";
import { normalizeNotify, normalizePopup } from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import { providerNames } from "@/utils/providers/providers";
import { normalizeReviewTime } from "@/utils/review-sessions/review-sessions";
import {
  appearanceItem,
  configItem,
  loadAppearance,
  loadConfig,
  loadNotify,
  loadPopup,
  loadReviewTime,
  notifyItem,
  reviewTimeItem,
  saveAppearance,
  saveConfig,
  saveNotify,
  savePopup,
  popupItem,
  saveReviewTime,
} from "@/utils/storage/storage";

const repoProblem = (repo: string) => (REPO_PATTERN.test(repo.trim()) ? "" : i18n.t("errorRepo"));

const filterCount = (value: Config) =>
  value.global.length + value.repos.reduce((sum, entry) => sum + entry.filters.length, 0);

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the element its template holds.
const clone = <T extends HTMLElement>(id: string): T => {
  const element = templateElement<T>(id);
  const holder = document.createElement("div");
  holder.append(element);
  translate(holder);
  return element;
};

const filterProblems = (filter: Filter) => {
  const problems: string[] = [];
  if (!filter.name.trim()) problems.push(i18n.t("errorName"));
  const include = compile(filter.include);
  const exclude = compile(filter.exclude);
  if (!include.ok) problems.push(i18n.t("errorRegex", [i18n.t("columnInclude"), include.error]));
  if (!exclude.ok) problems.push(i18n.t("errorRegex", [i18n.t("columnExclude"), exclude.error]));
  return { problems, name: !filter.name.trim(), include: !include.ok, exclude: !exclude.ok };
};

const label = (row: HTMLElement, filter: Filter) => {
  const name = filter.name.trim() || i18n.t("untitledFilter");
  $(".filter-fields", row).setAttribute("aria-label", name);
  $(".remove-filter", row).setAttribute("aria-label", i18n.t("removeNamed", [name]));
};

/**
 * What a switch or a button shows, like a section's settings or a review time's details, unrolls into place from the
 * top instead of popping in. Watched on the whole page, so whatever is shown that way later does the same.
 */
const unrollShown = () => {
  new MutationObserver((records) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease").trim() || "ease-out";
    for (const record of records) {
      const element = record.target;
      // `oldValue` is '' when it was hidden, and null when it wasn't.
      if (!(element instanceof HTMLElement) || record.oldValue === null || element.hidden) continue;
      element.animate(
        [
          { opacity: 0, transform: "translateY(-6px)", clipPath: "inset(0 0 100% 0)" },
          { opacity: 1, transform: "none", clipPath: "inset(0 0 0 0)" },
        ],
        { duration: 320, easing: ease },
      );
    }
  }).observe($("main"), { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true, subtree: true });
};

/** The settings page: filters, the bar's look, notifications, the popup and review time. */
export const startOptions = (): void => {
  type Field = "name" | "include" | "exclude";
  type Tone = "" | "ok" | "warn" | "error";
  type CheckableCard = HTMLElement & { check: (force: boolean) => boolean };

  const FIELDS: Field[] = ["name", "include", "exclude"];

  let uid = 0;
  const nextId = (prefix: string) => `${prefix}-${++uid}`;

  let config: Config = normalize({});
  let dirty = false;
  let edits = 0;
  let saving = false;
  let suggestedRepo = "";

  const status = $("#status");
  const savebar = $("#savebar");
  /** How long "Saved" stays up before the save bar goes away. */
  const SAVED_MS = 2500;
  let lowering = 0;
  /**
   * Says how saving stands. The save bar rises with anything to say, and is out of the way, and out of the tab order,
   * when there's nothing: once saved, it lowers after a moment.
   */
  const say = (text: string, tone: Tone = "") => {
    status.textContent = text;
    status.dataset.tone = tone;
    clearTimeout(lowering);
    savebar.toggleAttribute("data-raised", Boolean(text));
    savebar.inert = !text;
    if (tone === "ok")
      lowering = window.setTimeout(() => {
        say("");
      }, SAVED_MS);
  };
  const setDirty = () => {
    dirty = true;
    edits += 1;
    say(i18n.t("statusUnsaved"), "warn");
  };

  const showFilterProblems = (row: HTMLElement, filter: Filter, { force = false } = {}) => {
    const result = filterProblems(filter);
    const touched = force || Boolean(filter.name || filter.include || filter.exclude);
    for (const key of FIELDS) {
      const input = $<HTMLInputElement>(`.f-${key}`, row);
      if (touched && result[key]) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    $(".error", row).textContent = touched ? result.problems.join(" ") : "";
    return result.problems.length === 0;
  };

  const renderFilters = (filters: Filter[]) => {
    const block = clone("filters-template");
    const list = $(".filter-list", block);
    const addButton = $<HTMLButtonElement>(".add-filter", block);
    const syncEmpty = () => {
      $(".empty", block).hidden = filters.length > 0;
    };

    const addRow = (filter: Filter, focus: boolean) => {
      const row = clone("filter-template");
      const errorId = nextId("filter-error");
      $(".error", row).id = errorId;
      const labels: Record<Field, string> = {
        name: i18n.t("columnName"),
        include: i18n.t("labelInclude"),
        exclude: i18n.t("labelExclude"),
      };
      for (const key of FIELDS) {
        const input = $<HTMLInputElement>(`.f-${key}`, row);
        input.value = filter[key];
        input.setAttribute("aria-label", labels[key]);
        input.setAttribute("aria-describedby", errorId);
        input.addEventListener("input", () => {
          filter[key] = input.value;
          showFilterProblems(row, filter);
          if (key === "name") label(row, filter);
          setDirty();
          filtersChangedWhileTyping();
        });
      }
      $(".remove-filter", row).addEventListener("click", () => {
        const index = filters.indexOf(filter);
        filters.splice(index, 1);
        const rows = [...list.children].filter((child) => child instanceof HTMLElement);
        const neighbour = rows[index + 1] ?? rows[index - 1];
        row.remove();
        (neighbour ? $(".f-name", neighbour) : addButton).focus();
        syncEmpty();
        setDirty();
        filtersChanged();
      });
      label(row, filter);
      showFilterProblems(row, filter);
      list.append(row);
      syncEmpty();
      if (focus) $(".f-name", row).focus();
    };

    filters.forEach((filter) => {
      addRow(filter, false);
    });
    syncEmpty();
    addButton.addEventListener("click", () => {
      const filter: Filter = { id: newId(), name: "", include: "", exclude: "" };
      filters.push(filter);
      addRow(filter, true);
      setDirty();
    });
    return block;
  };

  const renderRepo = (entry: RepoFilters, focus: boolean) => {
    const card = clone<CheckableCard>("repo-template");
    const input = $<HTMLInputElement>(".repo-name", card);
    const error = $(".repo-error", card);
    const inputId = nextId("repo");
    input.id = inputId;
    error.id = `${inputId}-error`;
    $<HTMLLabelElement>(".repo-label", card).htmlFor = inputId;
    input.setAttribute("aria-describedby", error.id);
    input.value = entry.repo;

    const remove = $(".remove-repo", card);
    const syncLabel = () => {
      remove.setAttribute("aria-label", i18n.t("removeNamed", [entry.repo.trim() || i18n.t("thisRepository")]));
    };
    const check = (force: boolean) => {
      const problem = entry.repo || force ? repoProblem(entry.repo) : "";
      error.textContent = problem;
      if (problem) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      return !problem;
    };
    card.check = check;

    input.addEventListener("input", () => {
      entry.repo = input.value;
      syncLabel();
      if (input.hasAttribute("aria-invalid")) check(false);
      setDirty();
      filtersChangedWhileTyping();
    });
    input.addEventListener("blur", () => {
      check(false);
    });
    remove.addEventListener("click", () => {
      config.repos.splice(config.repos.indexOf(entry), 1);
      card.remove();
      syncRepos();
      $("#add-repo").focus();
      setDirty();
      filtersChanged();
    });

    syncLabel();
    $(".repo-body", card).append(renderFilters(entry.filters));
    $("#repos").append(card);
    syncRepos();
    if (focus) input.focus();
  };

  /** With no repository of its own yet, the section says what one is for. */
  function syncRepos() {
    $("#repos-empty").hidden = config.repos.length > 0;
  }

  const syncAddRepo = () => {
    $("#add-repo").textContent = suggestedRepo ? i18n.t("addRepoFor", [suggestedRepo]) : i18n.t("addRepo");
  };

  const updateTry = () => {
    const path = $<HTMLInputElement>("#try-path").value.trim();
    const repo = $<HTMLInputElement>("#try-repo").value.trim();
    const result = $("#try-result");
    if (!path) {
      result.textContent = i18n.t("tryEmpty");
      result.dataset.tone = "";
      return;
    }
    const filters = repo ? filtersFor(config, repo) : config.global;
    const shown = filters
      .filter((filter) => filter.name.trim() && toMatcher(filter)?.(path))
      .map((filter) => filter.name.trim());
    result.dataset.tone = shown.length > 0 ? "ok" : "";
    result.textContent =
      shown.length > 0
        ? i18n.t("tryShown", [i18n.t("filterAll"), shown.join(", ")])
        : i18n.t("tryOnlyAll", [i18n.t("filterAll")]);
  };

  /** The result is read out as it changes, so while typing it waits for a pause instead of speaking every keystroke. */
  const TYPING_PAUSE_MS = 400;
  let typing = 0;
  const updateTryWhileTyping = () => {
    clearTimeout(typing);
    typing = window.setTimeout(updateTry, TYPING_PAUSE_MS);
  };

  const filtersChanged = () => {
    updateTry();
    reviewTime.redraw();
  };
  let editing = 0;
  const filtersChangedWhileTyping = () => {
    clearTimeout(editing);
    editing = window.setTimeout(filtersChanged, TYPING_PAUSE_MS);
  };

  const save = async () => {
    const rows = [...document.querySelectorAll<HTMLElement>(".filter")];
    const filters = [...config.global, ...config.repos.flatMap((entry) => entry.filters)];
    const filtersOk = filters.every((filter) => filterProblems(filter).problems.length === 0);
    const cards = [...document.querySelectorAll<CheckableCard>(".repo")];
    const reposOk = cards.map((card) => card.check(true)).every(Boolean);

    const lookOk = look.check();
    const reviewOk = reviewTime.check();
    const notifyOk = notifications.check();
    const popupOk = popupSettings.check();
    if (!filtersOk || !reposOk) {
      // Every filter has its row, in the same order: the global ones', then each repository's.
      filters.forEach((filter, index) => {
        showFilterProblems(rows[index]!, filter, { force: true });
      });
      say(filtersOk ? i18n.t("statusFixRepos") : i18n.t("statusFixFilters"), "error");
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (!lookOk) {
      say(i18n.t("statusFixTheme"), "error");
      return;
    }
    if (!popupOk) {
      say(i18n.t("statusFixPopup"), "error");
      document.querySelector<HTMLElement>('#popup [aria-invalid="true"]')?.focus();
      return;
    }
    if (!reviewOk) {
      say(i18n.t("statusFixReview"), "error");
      reviewTime.focusError();
      return;
    }
    if (!notifyOk) {
      say(i18n.t("statusFixNotify"), "error");
      document.querySelector<HTMLElement>('#notifications [aria-invalid="true"]')?.focus();
      return;
    }
    // Each is saved on its own, so a quota error says which one is too big.
    let saved: "filters" | "look" | "popup" | "reviewTime" | "notifications" = "filters";
    const editsBefore = edits;
    try {
      saving = true;
      await saveConfig(config);
      saved = "look";
      await saveAppearance(look.value());
      saved = "popup";
      await savePopup(popupSettings.value());
      saved = "reviewTime";
      await saveReviewTime(reviewTime.value());
      saved = "notifications";
      await saveNotify(notifications.value());
      if (edits === editsBefore) {
        dirty = false;
        say(i18n.t("statusSaved"), "ok");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const quota = {
        filters: i18n.t("statusQuota"),
        look: i18n.t("statusQuotaTheme"),
        popup: i18n.t("statusQuotaPopup"),
        reviewTime: i18n.t("statusQuotaReview"),
        notifications: i18n.t("statusQuotaNotify"),
      }[saved];
      say(/QUOTA/iu.test(reason) ? quota : i18n.t("statusSaveError", [reason]), "error");
    } finally {
      saving = false;
    }
  };

  $("#save").addEventListener("click", () => void save());
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  });

  $("#add-repo").addEventListener("click", () => {
    const entry: RepoFilters = { repo: suggestedRepo, filters: [] };
    suggestedRepo = "";
    syncAddRepo();
    config.repos.push(entry);
    renderRepo(entry, true);
    setDirty();
  });

  ["#try-path", "#try-repo"].forEach((selector) => {
    $(selector).addEventListener("input", updateTryWhileTyping);
  });

  const notify = toaster($("#toast"));

  const copyFilters = async () => {
    const json = JSON.stringify(normalize(config), null, 2);
    if (await copyOrShow(json, $("#export-fallback"), $<HTMLTextAreaElement>("#export-json"))) {
      const count = filterCount(config);
      notify(i18n.t("copied", count, [count]));
    }
  };
  $("#export").addEventListener("click", () => void copyFilters());

  const importBox = $<HTMLTextAreaElement>("#json");
  const importButton = $<HTMLButtonElement>("#import");
  const importError = $("#json-error");
  const clearImportError = () => {
    importError.textContent = "";
    importBox.removeAttribute("aria-invalid");
  };

  importBox.addEventListener("input", () => {
    importButton.disabled = !importBox.value.trim();
    clearImportError();
  });

  importButton.addEventListener("click", () => {
    let imported: Config | null;
    try {
      imported = normalize(JSON.parse(importBox.value));
    } catch {
      imported = null;
    }
    if (!imported || isEmpty(imported)) {
      importError.textContent = imported ? i18n.t("importEmpty") : i18n.t("importInvalid", [i18n.t("copyButton")]);
      importBox.setAttribute("aria-invalid", "true");
      importBox.focus();
      return;
    }
    config = imported;
    render();
    setDirty();
    importBox.value = "";
    importButton.disabled = true;
    clearImportError();
    const count = filterCount(imported);
    notify(i18n.t("imported", count, [count]));
    $("#global-h").focus();
  });

  const render = () => {
    $("#global").replaceChildren(renderFilters(config.global));
    $("#repos").replaceChildren();
    config.repos.forEach((entry) => {
      renderRepo(entry, false);
    });
    syncRepos();
    filtersChanged();
  };

  const follow = <T>(item: { watch: (callback: (value: T) => void) => unknown }, apply: (value: T) => void) => {
    item.watch((value) => {
      if (saving) return;
      if (dirty) {
        say(i18n.t("statusChangedElsewhere"), "warn");
        return;
      }
      apply(value);
    });
  };

  // Another tab, the welcome page or another device changed the filters: follow along unless there are unsaved edits here.
  follow(configItem, (value) => {
    config = normalize(value);
    render();
  });

  const look = createLook({ onChange: setDirty, notify });

  follow(appearanceItem, (value) => {
    look.render(normalizeAppearance(value));
  });

  const notifications = createNotifications({ onChange: setDirty, say });
  const popupSettings = createPopupSettings({ onChange: setDirty });

  follow(popupItem, (value) => {
    popupSettings.render(normalizePopup(value));
  });

  const reviewTime = createReviewTime({
    onChange: setDirty,
    say,
    config: () => config,
    onEnabled: (on) => {
      notifications.setReviewTime(on);
    },
  });

  follow(reviewTimeItem, (value) => {
    reviewTime.render(normalizeReviewTime(value));
  });

  follow(notifyItem, (value) => {
    notifications.render(normalizeNotify(value));
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });

  /**
   * The section index marks the section being read, the one nearest the top of the screen. A section picked from a link
   * stays marked once the page gets there, even when it's too short to reach the top, until the reader scrolls on.
   */
  const sectionLinks = [...document.querySelectorAll<HTMLAnchorElement>(".sections a")];
  const sections = sectionLinks.flatMap((link) =>
    link.hash ? (document.querySelector<HTMLElement>(`#${CSS.escape(link.hash.slice(1))}`) ?? []) : [],
  );
  let picked: { id: string; y: number | null } | null = null;
  const markSection = () => {
    if (picked && (picked.y === null || Math.abs(scrollY - picked.y) < 4)) {
      setCurrent(picked.id);
      return;
    }
    picked = null;
    const line = innerHeight * 0.3;
    const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    const current = atEnd
      ? sections.at(-1)
      : (sections.findLast((section) => section.getBoundingClientRect().top <= line) ?? sections[0]);
    setCurrent(current?.id ?? "");
  };
  /** A highlight behind the current section's link, sliding from one to the next as the page moves. */
  const sectionList = sectionLinks[0]?.closest("ul");
  // A list item, so the list holds only items; hidden from screen readers, which hear `aria-current` instead.
  const sectionMark = document.createElement("li");
  sectionMark.className = "sections-mark";
  sectionMark.setAttribute("aria-hidden", "true");
  sectionList?.prepend(sectionMark);
  const placeMark = () => {
    const link = sectionLinks.find((each) => each.hasAttribute("aria-current"));
    if (!link || !sectionList) return;
    sectionMark.style.setProperty("--x", `${link.offsetLeft}px`);
    sectionMark.style.setProperty("--y", `${link.offsetTop}px`);
    sectionMark.style.setProperty("--w", `${link.offsetWidth}px`);
    sectionMark.style.setProperty("--h", `${link.offsetHeight}px`);
    // On a narrow screen the index is a row that scrolls sideways; the current one is brought into it.
    if (sectionList.scrollWidth > sectionList.clientWidth) {
      const left = link.offsetLeft - (sectionList.clientWidth - link.offsetWidth) / 2;
      sectionList.scrollTo({
        left,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  };
  const setCurrent = (id: string) => {
    let changed = false;
    for (const link of sectionLinks) {
      const current = link.hash === `#${id}`;
      if (current === link.hasAttribute("aria-current")) continue;
      changed = true;
      if (current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    if (changed) placeMark();
  };
  addEventListener("resize", placeMark);

  /** Where the page ends up once a jump is over; a jump that doesn't move the page is over at once. */
  const settle = () => {
    if (picked && picked.y === null) picked.y = scrollY;
  };
  /** A section jumped to, by a link or the address it was opened at. */
  const pick = (id: string) => {
    if (!sections.some((section) => section.id === id)) return;
    picked = { id, y: null };
    setCurrent(id);
    // Not every browser fires scrollend; a jump is over well within a second.
    setTimeout(settle, 1000);
  };
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (link) pick(link.hash.slice(1));
  });
  addEventListener("scrollend", settle);
  addEventListener(
    "scroll",
    () => {
      requestAnimationFrame(markSection);
    },
    { passive: true },
  );
  addEventListener("resize", markSection);

  translateDocument(i18n.t("optionsTitle"));
  $("#tagline").textContent = i18n.t("optionsTagline", [providerNames(uiLanguage())]);
  $("#version").textContent = i18n.t("optionsVersion", [browser.runtime.getManifest().version]);

  /** `#repo=owner/name` comes from the panel on that repository: it's tried, and offered as a new repository. */
  const applyRepoHash = () => {
    const repo = new URLSearchParams(location.hash.slice(1)).get("repo");
    if (repo) {
      $<HTMLInputElement>("#try-repo").value = repo;
      suggestedRepo = config.repos.some((entry) => repoMatches(entry.repo, repo)) ? "" : repo;
    }
    syncAddRepo();
    updateTry();
  };
  window.addEventListener("hashchange", applyRepoHash);

  // Opened again from a pull request: this tab comes forward, with that repository, instead of a new one opening.
  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message?.type !== "show-options") return;
    sendResponse(true);
    if (message.repo) location.hash = `repo=${encodeURIComponent(message.repo)}`;
    else if (message.section) document.querySelector(`#${CSS.escape(message.section)}`)?.scrollIntoView();
    void browser.tabs.getCurrent().then((tab) => {
      if (tab?.id === undefined) return;
      void browser.tabs.update(tab.id, { active: true });
      void browser.windows.update(tab.windowId, { focused: true });
    });
  });

  void Promise.all([loadConfig(), loadAppearance(), loadNotify(), loadReviewTime(), loadPopup()]).then(
    ([loaded, appearance, notifySettings, review, popup]) => {
      config = loaded;
      render();
      look.render(appearance);
      popupSettings.render(popup);
      notifications.render(notifySettings);
      reviewTime.render(review);
      // Opened on a section, like Notifications from the popup: it's further down once everything above it has drawn.
      if (/^#[\w-]+$/u.test(location.hash)) {
        document.querySelector(location.hash)?.scrollIntoView();
        pick(location.hash.slice(1));
      }
      markSection();
      placeMark();
      // Only once the page is drawn, so the first drawing doesn't unroll everything.
      requestAnimationFrame(() => {
        sectionMark.classList.add("ready");
        unrollShown();
      });
      reveal();
      applyRepoHash();
    },
  );
};
