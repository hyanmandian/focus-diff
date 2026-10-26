import { browser } from "wxt/browser";

import { i18n } from "#i18n";
import type { ContentScriptContext } from "#imports";
import type { Panel } from "@/components/panel/panel";
import type { Totals } from "@/components/stats/stats";
import { createActiveTime, type OnScreen } from "@/utils/active-time/active-time";
import { createStyler, normalizeAppearance } from "@/utils/appearance/appearance";
import { cloneOf } from "@/utils/dom/dom";
import { ALL, filtersFor, normalize, toMatcher, type Config, type Matcher } from "@/utils/filters/filters";
import { formatNumber as format } from "@/utils/format/format";
import type { Message } from "@/utils/messages/messages";
import type { PageCounters, Provider } from "@/utils/provider/provider";
import { collectFiles, type FileInfo, type Files } from "@/utils/review-files/review-files";
import { createNavigation, goToFile } from "@/utils/review-navigation/review-navigation";
import { normalizeReviewTime, type ReviewTimeSettings } from "@/utils/review-sessions/review-sessions";
import {
  createEstimator,
  learnFile,
  normalizeLearned,
  PACES,
  reviewMinutes,
  type Estimator,
} from "@/utils/review-time/review-time";
import { createReviewView, nextFilterWithWork, review, toggled, type Option } from "@/utils/review/review";
import { scrollToTop, waitFor } from "@/utils/scroll/scroll";
import {
  appearanceItem,
  configItem,
  loadAppearance,
  loadConfig,
  learnedItem,
  loadReviewTime,
  reviewTimeItem,
  selectionsItem,
  updateItem,
  type Selections,
} from "@/utils/storage/storage";
import { canTransition, removeTransitionStyle, withTransition } from "@/utils/transition/transition";

/** A site keeps drawing while a pull request loads; page changes wait for idle time, at most this long. */
const IDLE_TIMEOUT_MS = 200;

const show = (element: HTMLElement, visible: boolean) => {
  const display = visible ? "" : "none";
  if (element.style.display !== display) element.style.display = display;
};

/**
 * Filters a rendered diff. The newer, virtualized list places each file by the height it measured, so there the file's
 * row stays and only the file in it is hidden: the list measures the row again and closes up around it.
 */
const present = (diff: { element: HTMLElement; container: HTMLElement }, visible: boolean, virtualized: boolean) => {
  const hidden = virtualized ? diff.element : diff.container;
  for (const element of new Set([diff.container, diff.element])) show(element, visible || element !== hidden);
};

const COUNTER_COPY = "data-focus-diff-counter";

/**
 * Shows `value` in place of one of the site's counters through a copy beside it, so the site keeps updating its own node.
 * `null` removes the copy and shows the original again.
 */
const mirror = (original: HTMLElement | null, value: string | null) => {
  if (!original) return;
  let copy =
    original.nextElementSibling instanceof HTMLElement && original.nextElementSibling.hasAttribute(COUNTER_COPY)
      ? original.nextElementSibling
      : null;
  if (value === null) {
    copy?.remove();
    show(original, true);
    return;
  }
  if (!copy) {
    copy = cloneOf(original, false);
    copy.removeAttribute("id");
    copy.removeAttribute("title");
    copy.setAttribute(COUNTER_COPY, "");
    original.after(copy);
  }
  if (copy.textContent !== value) copy.textContent = value;
  show(original, false);
};

/** Hides tree files outside the filter, and folders left with nothing to show. */
const filterTree = (
  provider: Provider,
  matches: Matcher,
  filtering: boolean,
  shownPaths: string[],
  pathByAnchor: Map<string, string>,
) => {
  const folders = new Set<string>();
  const keepFoldersOf = (path: string) => {
    for (let end = path.lastIndexOf("/"); end > 0; end = path.lastIndexOf("/", end - 1))
      folders.add(path.slice(0, end));
  };
  for (const path of shownPaths) keepFoldersOf(path);
  for (const file of provider.tree.files()) {
    const path = pathByAnchor.get(file.anchor) ?? provider.tree.pathOf(file.element);
    const visible = matches(path);
    show(file.element, visible);
    if (visible) keepFoldersOf(path);
  }
  for (const folder of provider.tree.folders()) show(folder.element, !filtering || folders.has(folder.path));
};

/** Every counter the site shows, found or not. */
const counterList = ({ files, additions, deletions }: PageCounters) => [files, additions, deletions];

const updatePageCounters = (provider: Provider, totals: Totals, filtering: boolean) => {
  const counters = provider.counters();
  const number = provider.formatCount;
  if (!filtering) {
    counterList(counters).forEach((counter) => {
      mirror(counter, null);
    });
    return;
  }
  mirror(counters.files, `${number(totals.visible)}/${number(totals.total)}`);
  const complete = totals.pending === 0;
  mirror(counters.additions, complete ? `+${number(totals.additions)}` : null);
  mirror(counters.deletions, complete ? `−${number(totals.deletions)}` : null);
};

/** Puts the page back the way the site drew it. */
const restorePage = (provider: Provider) => {
  for (const diff of provider.diffs()) present(diff, true, false);
  provider.closeUp?.([], 0);
  for (const item of provider.tree.files()) show(item.element, true);
  for (const folder of provider.tree.folders()) show(folder.element, true);
  counterList(provider.counters()).forEach((counter) => {
    mirror(counter, null);
  });
};

/** Compiled filters, kept until the configuration changes. Each matcher remembers its answer per path. */
const memoize = (matches: Matcher): Matcher => {
  const answers = new Map<string, boolean>();
  return (path) => {
    let answer = answers.get(path);
    if (answer === undefined) {
      answer = matches(path);
      answers.set(path, answer);
    }
    return answer;
  };
};

export interface Controller {
  toggle: (id: string) => void;
  openSettings: () => void;
  comment: (step: 1 | -1) => void;
  nextUnviewed: () => void;
  dismissUpdate: () => void;
}

const changesElements = (record: MutationRecord) =>
  record.type === "attributes" ||
  [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element);

const dismissUpdate = () => void updateItem.setValue(null);

/** Runs the bar on one review site: reads its page through `provider`, and filters it as the reader picks filters. */
export const startController = async (
  ctx: ContentScriptContext,
  panel: Panel,
  provider: Provider,
): Promise<Controller> => {
  const restyle = createStyler(panel.setTheme, provider.id);
  await restyle(await loadAppearance());
  let config: Config = await loadConfig();
  let selections: Selections = await selectionsItem.getValue();
  // The reader's pace, from Review time and what it has learned, so the bar's estimates and review time's agree.
  let reviewTime: ReviewTimeSettings = await loadReviewTime();
  let learned = normalizeLearned(await learnedItem.getValue());
  let estimator: Estimator = reviewMinutes;
  const reestimate = () => (estimator = createEstimator(PACES[reviewTime.pace], reviewTime.learn ? learned : null));
  reestimate();
  let pending: "frame" | "idle" | null = null;
  let announceNext = false;

  let compiled: { config: Config; repo: string; filters: Option[] } | null = null;
  const filters = (repo: string): Option[] => {
    if (compiled?.config === config && compiled.repo === repo) return compiled.filters;
    const list = filtersFor(config, repo).flatMap((filter) => {
      const matcher = toMatcher(filter);
      return filter.name && matcher ? [{ id: filter.id, name: filter.name, matches: memoize(matcher) }] : [];
    });
    compiled = { config, repo, filters: list };
    return list;
  };

  const optionsFor = (repo: string): Option[] => [{ id: ALL, name: i18n.t("filterAll") }, ...filters(repo)];

  let files: Files = { list: [], complete: false };

  /**
   * The reader's saved filters for a repository, less those with no files in this pull request; with none left, All.
   * The saved choice stays as it is, so another pull request in the repository still gets the full set.
   */
  const selectedIds = (repo: string) => {
    const matchers = new Map(filters(repo).map((filter) => [filter.id, filter.matches]));
    return (selections[repo] ?? []).filter((id) => {
      const matches = matchers.get(id);
      return Boolean(matches) && hasFiles(matches);
    });
  };

  /** Files the site hasn't loaded yet could still match any filter, so a filter's count is only final once they're in. */
  const loading = () => !files.complete && provider.reportedFileCount() > files.list.length;
  /** Whether a filter has, or may yet have, files in this pull request. */
  const hasFiles = (matches?: Matcher) => !matches || loading() || files.list.some((file) => matches(file.path));

  const choose = (ids: string[]) => {
    const repo = provider.repository();
    if (!repo || ctx.isInvalid) return;
    selections = { ...selections, [repo]: ids };
    void selectionsItem.setValue(selections);
    announceNext = true;
    chosen = true;
    schedule();
  };

  const select = (id: string) => {
    choose(id === ALL ? [] : [id]);
  };

  const toggle = (id: string) => {
    const repo = provider.repository();
    if (!repo) {
      select(ALL);
      return;
    }
    choose(toggled(selectedIds(repo), id));
  };

  const step = (offset: number) => {
    const repo = provider.repository();
    if (!repo) return;
    // Filters with nothing in this pull request are skipped.
    const ids = optionsFor(repo)
      .filter((option) => hasFiles(option.matches))
      .map((option) => option.id);
    const index = Math.max(0, ids.indexOf(selectedIds(repo)[0] ?? ALL));
    // All is always among them, so there's always a next one.
    select(ids[(index + offset + ids.length) % ids.length]!);
  };

  const openSettings = () => {
    const repo = provider.repository();
    const message: Message =
      repo && filters(repo).length > 0 ? { type: "open-options", repo } : { type: "open-welcome" };
    void browser.runtime.sendMessage(message);
  };

  const covered = () => provider.coveredTop();
  let pageChanged = false;
  let selectionKey = "";
  let shown: FileInfo[] = [];
  const navigation = createNavigation(provider, panel, () => {
    schedule();
  });
  const showReview = createReviewView(panel);
  const comment = (direction: 1 | -1) => void navigation.comment(shown, files.complete, direction);

  /**
   * The next shown file left to review, after the one at the top of the screen, wrapping around. With none left in the
   * shown filters, the next filter with files to review is picked, which takes the reader to its first one.
   */
  const nextUnviewed = () => {
    const repo = provider.repository();
    if (!repo) return;
    const left = shown.filter((file) => !file.viewed);
    const [first] = left;
    if (!first) {
      const ids = selectedIds(repo);
      const then = ids.length > 0 ? nextFilterWithWork(files.list, filters(repo), ids) : undefined;
      if (then) choose([then.id]);
      return;
    }
    const top = provider.coveredTop();
    const atTop = shown.findIndex((file) => (file.diff?.container.getBoundingClientRect().bottom ?? 0) > top + 1);
    const current = shown[atTop];
    // The file at the top counts when it hasn't been brought all the way up yet.
    const currentIsNext =
      current && !current.viewed && (current.diff?.container.getBoundingClientRect().top ?? 0) > top + 4;
    const target = currentIsNext ? current : (left.find((file) => shown.indexOf(file) > atTop) ?? first);
    void goToFile(provider, target);
    panel.announceText(i18n.t("panelJumpedToFile", left.length, [target.path, format(left.length)]));
  };

  /**
   * A file the reader just marked viewed is one they reviewed: the time they spent on it, next to what the starting pace
   * gave it, teaches the estimates their pace. A file ticked off in a few seconds was skipped, not reviewed.
   */
  const activeTime = createActiveTime(ctx, () =>
    provider.diffs().flatMap((diff): OnScreen => {
      const box = diff.container.getBoundingClientRect();
      const height = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
      return height > 0 ? [[diff.path, height]] : [];
    }),
  );
  /** A file marked viewed after less than this wasn't reviewed, only ticked off. */
  const MIN_REVIEW_SECONDS = 2;
  /**
   * Files seen not viewed on this page: only those can be learned from once marked. GitHub loads the list a bit at a
   * time, so a file already viewed can turn up later, and that's not the reader marking it.
   */
  let unviewed = { pathname: "", paths: new Set<string>() };
  const learnFromViewed = async (list: FileInfo[]) => {
    if (unviewed.pathname !== location.pathname) unviewed = { pathname: location.pathname, paths: new Set() };
    const marked = list.filter((file) => file.viewed && unviewed.paths.has(file.path));
    for (const file of list) if (!file.viewed) unviewed.paths.add(file.path);
    for (const file of marked) unviewed.paths.delete(file.path);
    if (!reviewTime.learn) return;
    // Without its line counts, there's nothing to tell the time spent on a file against.
    const samples = marked.flatMap((file) => {
      const seconds = activeTime.take(file.path);
      return file.stats && seconds >= MIN_REVIEW_SECONDS
        ? [
            {
              path: file.path,
              expected: reviewMinutes(file.path, file.stats, PACES[reviewTime.pace]),
              actual: seconds / 60,
            },
          ]
        : [];
    });
    if (samples.length === 0) return;
    // Read again first: another tab may have learned something since.
    let latest = normalizeLearned(await learnedItem.getValue());
    for (const sample of samples) latest = learnFile(latest, sample.path, sample.expected, sample.actual);
    learned = latest;
    await learnedItem.setValue(latest);
  };

  const apply = () => {
    pending = null;
    if (ctx.isInvalid) return;
    const repo = provider.repository();
    observe(Boolean(repo));
    panel.setVisible(Boolean(repo));
    if (!repo) {
      if (pageChanged) restorePage(provider);
      pageChanged = false;
      return;
    }

    files = collectFiles(provider);
    void learnFromViewed(files.list);
    const reported = provider.reportedFileCount();
    const current = review(files, optionsFor(repo), selectedIds(repo), {
      reported,
      loading: loading(),
      minutes: estimator,
    });
    const { filtering, matches, selection, totals } = current;
    const virtualized = provider.isVirtualized();
    shown = current.shown;
    for (const file of files.list) if (file.diff) present(file.diff, matches(file.path), virtualized);
    // Places in the list are only known from the site's data, which lists every file in order.
    provider.closeUp?.(
      virtualized && files.complete && filtering
        ? files.list.flatMap((file, index) =>
            matches(file.path) || !file.anchor ? [] : [{ index, anchor: file.anchor }],
          )
        : [],
      files.list.length,
    );
    filterTree(
      provider,
      matches,
      filtering,
      shown.map((file) => file.path),
      new Map(files.list.filter((file) => file.anchor).map((file) => [file.anchor, file.path])),
    );
    // A new pull request or a new selection starts the conversation count over.
    const key = `${location.pathname} ${selection.join()}`;
    if (selectionKey !== key) {
      selectionKey = key;
      navigation.reset();
    }
    panel.renderConversations(
      navigation.position(shown, files.complete),
      filtering ? navigation.count(files.list, files.complete) : undefined,
    );
    updatePageCounters(provider, totals, filtering);
    pageChanged = filtering;
    showReview(current, key, { announce: announceNext });
    announceNext = false;
  };

  /**
   * Reader actions apply on the next frame; changes the site makes to the page wait for idle time. A frame request
   * overtakes a pending idle one, which then does nothing.
   */
  let ticket = 0;
  /** Set by the reader picking filters, so that apply animates and goes to the first unviewed file. */
  let chosen = false;
  const pieces = () =>
    files.list.flatMap((file) =>
      file.diff?.container.isConnected ? [{ key: file.path, element: file.diff.container }] : [],
    );

  const schedule = (when: "frame" | "idle" = "frame") => {
    if (ctx.isInvalid || pending === "frame" || pending === when) return;
    pending = when;
    const mine = ++ticket;

    const run = () => {
      if (mine !== ticket) return;
      if (!chosen) {
        apply();
        return;
      }
      // A new selection: the files on screen move into place at the first file left to review, in one motion.
      chosen = false;
      let undrawn: FileInfo | undefined;
      // Inside a transition the move is the animation, so the scroll itself is instant.
      const behavior = canTransition() ? "instant" : undefined;
      void withTransition(() => {
        apply();
        // Picked again while this change was being prepared: that pick gets its own turn.
        if (chosen) schedule();
        const next = shown.find((file) => !file.viewed);
        if (next?.diff?.element.isConnected) scrollToTop(next.diff.container, covered, behavior);
        else undrawn = next;
      }, pieces).then(() => {
        // A file the site hasn't drawn yet is opened once the motion is over.
        if (undrawn) void goToFile(provider, undrawn);
      });
    };
    // A tab in the background draws no frames, so there even the reader's changes wait for idle time.
    if (when === "frame" && !document.hidden) ctx.requestAnimationFrame(run);
    // Safari has no requestIdleCallback; a short timeout keeps page changes batched there.
    else if ("requestIdleCallback" in window) ctx.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else ctx.setTimeout(run, IDLE_TIMEOUT_MS / 4);
  };

  /** New diffs get filtered on the next frame so they never flash in; text-only changes, like ticking timestamps, are ignored. */
  const pageObserver = new MutationObserver((records) => {
    const relevant = records.filter((each) => changesElements(each));
    if (relevant.length === 0) return;
    const urgent = relevant.some(
      (record) => record.type === "attributes" || [...record.addedNodes].some((each) => provider.containsDiff(each)),
    );
    schedule(urgent ? "frame" : "idle");
  });
  let observing = false;
  const observe = (active: boolean) => {
    if (active === observing) return;
    observing = active;
    // Some Viewed toggles only change an attribute; checkboxes fire `change`, which is watched below.
    if (active)
      pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: provider.observedAttributes.length > 0,
        ...(provider.observedAttributes.length > 0 ? { attributeFilter: provider.observedAttributes } : {}),
      });
    else pageObserver.disconnect();
  };

  const onMessage = (message: Message) => {
    if (message?.type !== "command") return;
    if (message.command === "next-filter") step(1);
    if (message.command === "previous-filter") step(-1);
    if (message.command === "show-all") select(ALL);
    if (message.command === "next-unviewed") nextUnviewed();
    if (message.command === "next-comment") comment(1);
    if (message.command === "previous-comment") comment(-1);
  };
  browser.runtime.onMessage.addListener(onMessage);

  const unwatchConfig = configItem.watch((value) => {
    config = normalize(value);
    schedule();
  });
  const unwatchReviewTime = reviewTimeItem.watch((value) => {
    reviewTime = normalizeReviewTime(value);
    reestimate();
    schedule();
  });
  const unwatchLearned = learnedItem.watch((value) => {
    learned = normalizeLearned(value);
    reestimate();
    schedule();
  });
  const unwatchSelections = selectionsItem.watch((value) => {
    selections = value;
    schedule();
  });
  panel.showUpdate(await updateItem.getValue());
  const unwatchUpdate = updateItem.watch((version) => {
    panel.showUpdate(version);
  });
  const unwatchAppearance = appearanceItem.watch((value) => void restyle(normalizeAppearance(value)));

  ctx.addEventListener(window, "wxt:locationchange", () => {
    schedule();
  });

  // A file picked in the site's tree scrolls smoothly from where the page was, and lines up below the sticky bar
  // instead of under it. The site still updates the address and the tree; a jump of its own is undone before it's painted.
  ctx.addEventListener(
    document,
    "click",
    (event) => {
      const anchor = provider.tree.anchorAt(event.target);
      if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const from = scrollY;
      const bringIn = (diff: HTMLElement) => {
        if (scrollY !== from) scrollTo({ top: from });
        scrollToTop(files.list.find((file) => file.diff?.element === diff)?.diff?.container ?? diff, covered);
      };
      const diff = provider.diffAt(anchor);
      if (diff) {
        event.preventDefault();
        history.pushState(history.state, "", provider.hashOf(anchor));
        ctx.requestAnimationFrame(() => {
          bringIn(diff);
        });
      } else {
        // Not drawn yet: the site brings it in, then it's lined up.
        void waitFor(() => provider.diffAt(anchor)).then((found) => {
          if (found) scrollToTop(found, covered);
        });
      }
    },
    { capture: true },
  );
  ctx.addEventListener(
    document,
    "change",
    () => {
      schedule();
    },
    { capture: true },
  );
  ctx.onInvalidated(() => {
    pageObserver.disconnect();
    removeTransitionStyle();
    if (pageChanged) restorePage(provider);
    if (!browser.runtime?.id) return;
    browser.runtime.onMessage.removeListener(onMessage);
    unwatchConfig();
    unwatchSelections();
    unwatchReviewTime();
    unwatchLearned();
    unwatchUpdate();
    unwatchAppearance();
  });

  // The first pass runs straight away, not on the next frame, so a pull request opened in a background tab is already
  // filtered when the reader gets to it.
  apply();
  return { toggle, openSettings, comment, nextUnviewed, dismissUpdate };
};
