import type { Next } from "@focus-diff/app/components/filter-bar";
import type { Config, DiffFilter } from "@focus-diff/app/utils/config";
import { filtersFor, nextFilterWithWork, stepFilter, toggled, totals } from "@focus-diff/app/utils/filters";
import { i18n } from "@focus-diff/app/utils/i18n";
import type { ReviewFile } from "@focus-diff/app/utils/review";
import type { OnScreen } from "@focus-diff/core/active-time";
import {
  createEstimator,
  LINES_PER_HOUR,
  reviewMinutes,
  type Estimator,
  type Learned,
} from "@focus-diff/core/estimate";
import { inFilter, type Matcher } from "@focus-diff/core/filters";
import { browser } from "wxt/browser";

import type { ContentScriptContext } from "#imports";
import { createActiveTime } from "@/utils/active-time/active-time";
import { applyLanguage } from "@/utils/bar-language/bar-language";
import {
  learn,
  loadConfig,
  loadLearned,
  selectionsItem,
  watchConfig,
  watchLearned,
  type Selections,
} from "@/utils/bar-settings/bar-settings";
import { isDark, watchAppearance } from "@/utils/bar-theme/bar-theme";
import { cloneOf } from "@/utils/dom/dom";
import type { Message } from "@/utils/messages/messages";
import type { PageCounters, Provider } from "@/utils/provider/provider";
import { collectFiles, type FileInfo, type Files } from "@/utils/review-files/review-files";
import { goToFile } from "@/utils/review-navigation/review-navigation";
import { scrollToTop, waitFor } from "@/utils/scroll/scroll";
import { canTransition, removeTransitionStyle, withTransition } from "@/utils/transition/transition";

/** What the bar draws: the app's FilterBar's props (packages/app/src/components/filter-bar). */
export interface BarProps {
  files: ReviewFile[];
  filters: DiffFilter[];
  chosen: string[];
  shown: ReturnType<typeof totals>;
  next: Next;
  isViewed: (file: ReviewFile) => boolean;
  minutesOf: Estimator;
  learned: Learned | null;
  onToggle: (id: string) => void;
  onNextFile: () => void;
}

/** Where the bar is drawn (components/mount-bar). */
export interface BarView {
  /** Draws the bar, or takes it away with `null`. */
  render: (props: BarProps | null) => void;
  setDark: (dark: boolean) => void;
  /** The language it's read out in, as <html lang> says it. */
  setLocale: (locale: string) => void;
}

/** A site keeps drawing while a pull request loads; page changes wait for idle time, at most this long. */
const IDLE_TIMEOUT_MS = 200;
/** A file marked viewed after less than this wasn't reviewed, only ticked off. */
const MIN_REVIEW_SECONDS = 2;

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

/** The site's counters, while a filter is on: the files shown of all of them, and their lines once all are known. */
const updatePageCounters = (provider: Provider, files: Files, shown: FileInfo[], filtering: boolean) => {
  const counters = provider.counters();
  if (!filtering) {
    for (const counter of counterList(counters)) mirror(counter, null);
    return;
  }
  const number = provider.formatCount;
  const total = files.complete ? files.list.length : Math.max(files.list.length, provider.reportedFileCount());
  mirror(counters.files, `${number(shown.length)}/${number(total)}`);
  const complete = total === files.list.length && shown.every((file) => file.stats);
  const sum = (key: "additions" | "deletions") => shown.reduce((all, file) => all + file.stats![key], 0);
  mirror(counters.additions, complete ? `+${number(sum("additions"))}` : null);
  mirror(counters.deletions, complete ? `−${number(sum("deletions"))}` : null);
};

/** Puts the page back the way the site drew it. */
const restorePage = (provider: Provider) => {
  for (const diff of provider.diffs()) present(diff, true, false);
  provider.closeUp?.([], 0);
  for (const item of provider.tree.files()) show(item.element, true);
  for (const folder of provider.tree.folders()) show(folder.element, true);
  for (const counter of counterList(provider.counters())) mirror(counter, null);
};

/** A filter's matcher, kept with the answer for each path. */
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

/** A file as the app's bar counts it. */
const asReviewFile = (file: FileInfo): ReviewFile => ({
  path: file.path,
  previousPath: null,
  status: "modified",
  additions: file.stats?.additions ?? 0,
  deletions: file.stats?.deletions ?? 0,
  patch: "",
});

const changesElements = (record: MutationRecord) =>
  record.type === "attributes" ||
  [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element);

export interface Controller {
  toggle: (id: string) => void;
  nextUnviewed: () => void;
}

/** Runs the bar on one review site: reads its page through `provider`, and filters it as the reader picks filters. */
export const startController = async (
  ctx: ContentScriptContext,
  view: BarView,
  provider: Provider,
): Promise<Controller> => {
  let config: Config = await loadConfig();
  let selections: Selections = await selectionsItem.getValue();
  let learned: Learned | null = await loadLearned();
  let estimator: Estimator = createEstimator(LINES_PER_HOUR, learned);
  let pending: "frame" | "idle" | null = null;

  const appearance = () => {
    view.setDark(isDark(config.theme));
  };
  const speak = () => {
    applyLanguage(config.language);
    view.setLocale(i18n().locale);
  };
  appearance();
  speak();

  let compiled: { config: Config; repo: string; filters: Array<DiffFilter & { matches: Matcher }> } | null = null;
  /** The filters this repository gets, each with its matcher (lenient, as the bar counts them). */
  const filters = (repo: string) => {
    if (compiled?.config === config && compiled.repo === repo) return compiled.filters;
    const list = filtersFor(config.filters, repo).map((filter) => ({
      ...filter,
      matches: memoize((path) => inFilter(filter, path)),
    }));
    compiled = { config, repo, filters: list };
    return list;
  };

  let files: Files = { list: [], complete: false };

  /** Files the site hasn't loaded yet could still match any filter, so a filter's count is only final once they're in. */
  const loading = () => !files.complete && provider.reportedFileCount() > files.list.length;
  /** Whether a filter has, or may yet have, files in this pull request. */
  const hasFiles = (matches: Matcher) => loading() || files.list.some((file) => matches(file.path));

  /**
   * The reader's chosen filters for a repository, less those with no files in this pull request; with none left, All.
   * The saved choice stays as it is, so another pull request in the repository still gets the full set.
   */
  const chosenIds = (repo: string) => {
    const matchers = new Map(filters(repo).map((filter) => [filter.id, filter.matches]));
    return (selections[repo] ?? []).filter((id) => {
      const matches = matchers.get(id);
      return matches !== undefined && hasFiles(matches);
    });
  };

  /** Set by the reader picking filters, so that apply animates and goes to the first unviewed file. */
  let chosen = false;
  const choose = (ids: string[]) => {
    const repo = provider.repository();
    if (!repo || ctx.isInvalid) return;
    selections = { ...selections, [repo]: ids };
    void selectionsItem.setValue(selections);
    chosen = true;
    schedule();
  };

  const toggle = (id: string) => {
    const repo = provider.repository();
    if (repo) choose(toggled(chosenIds(repo), id));
  };

  /** The next or previous filter (All among them), skipping those with nothing in this pull request. */
  const step = (by: 1 | -1) => {
    const repo = provider.repository();
    if (!repo) return;
    const options = filters(repo).flatMap((filter) => (hasFiles(filter.matches) ? [filter.id] : []));
    choose(stepFilter(options, chosenIds(repo), by));
  };

  const covered = () => provider.coveredTop();
  let pageChanged = false;
  let shown: FileInfo[] = [];

  /**
   * The next shown file left to review, after the one at the top of the screen, wrapping around. With none left in the
   * chosen filters, the next filter with files to review is picked, which takes the reader to its first one.
   */
  const nextUnviewed = () => {
    const repo = provider.repository();
    if (!repo) return;
    const left = shown.filter((file) => !file.viewed);
    const [first] = left;
    if (!first) {
      const ids = chosenIds(repo);
      const viewed = new Map(files.list.map((file) => [file.path, file.viewed]));
      const then =
        ids.length > 0
          ? nextFilterWithWork(files.list.map(asReviewFile), filters(repo), ids, (file) => viewed.get(file.path)!)
          : undefined;
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
    // Without its line counts, there's nothing to tell the time spent on a file against.
    const samples = marked.flatMap((file) => {
      const seconds = activeTime.take(file.path);
      return file.stats && seconds >= MIN_REVIEW_SECONDS
        ? [{ path: file.path, expected: reviewMinutes(file.path, file.stats), actual: seconds / 60 }]
        : [];
    });
    if (samples.length > 0) relearn(await learn(samples));
  };

  const relearn = (next: Learned) => {
    learned = next;
    estimator = createEstimator(LINES_PER_HOUR, learned);
  };

  const draw = (repo: string, ids: string[]) => {
    const list = files.list.map(asReviewFile);
    const viewed = new Map(files.list.map((file) => [file.path, file.viewed]));
    const isViewed = (file: ReviewFile) => viewed.get(file.path)!;
    const shownPaths = new Set(shown.map((file) => file.path));
    const inView = list.filter((file) => shownPaths.has(file.path));
    const left = inView.filter((file) => !isViewed(file)).length;
    const repoFilters = filtersFor(config.filters, repo);
    view.render({
      files: list,
      filters: repoFilters,
      chosen: ids,
      shown: totals(inView, isViewed, estimator),
      next: {
        left,
        nextFilter: ids.length > 0 && !left ? nextFilterWithWork(list, repoFilters, ids, isViewed) : undefined,
      },
      isViewed,
      minutesOf: estimator,
      learned,
      onToggle: toggle,
      onNextFile: nextUnviewed,
    });
  };

  const apply = () => {
    pending = null;
    if (ctx.isInvalid) return;
    const repo = provider.repository();
    observe(Boolean(repo));
    if (!repo) {
      view.render(null);
      if (pageChanged) restorePage(provider);
      pageChanged = false;
      return;
    }

    files = collectFiles(provider);
    void learnFromViewed(files.list);
    const ids = chosenIds(repo);
    const picked = filters(repo).filter((filter) => ids.includes(filter.id));
    const filtering = picked.length > 0;
    const matches: Matcher = filtering ? (path) => picked.some((filter) => filter.matches(path)) : () => true;
    const virtualized = provider.isVirtualized();
    shown = files.list.filter((file) => matches(file.path));
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
    updatePageCounters(provider, files, shown, filtering);
    pageChanged = filtering;
    draw(repo, ids);
  };

  /**
   * Reader actions apply on the next frame; changes the site makes to the page wait for idle time. A frame request
   * overtakes a pending idle one, which then does nothing.
   */
  let ticket = 0;
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
      // A new choice: the files on screen move into place at the first file left to review, in one motion.
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
    if (message.command === "show-all") choose([]);
    if (message.command === "next-unviewed") nextUnviewed();
  };
  browser.runtime.onMessage.addListener(onMessage);

  const unwatchConfig = watchConfig((value) => {
    config = value;
    appearance();
    speak();
    schedule();
  });
  const unwatchLearned = watchLearned((value) => {
    relearn(value);
    schedule();
  });
  const unwatchSelections = selectionsItem.watch((value) => {
    selections = value;
    schedule();
  });
  const unwatchAppearance = watchAppearance(appearance);

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
    unwatchAppearance();
    if (pageChanged) restorePage(provider);
    if (!browser.runtime?.id) return;
    browser.runtime.onMessage.removeListener(onMessage);
    unwatchConfig();
    unwatchSelections();
    unwatchLearned();
  });

  // The first pass runs straight away, not on the next frame, so a pull request opened in a background tab is already
  // filtered when the reader gets to it.
  apply();
  return { toggle, nextUnviewed };
};
