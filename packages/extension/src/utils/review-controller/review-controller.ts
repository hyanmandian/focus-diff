import type { OnScreen } from "@focus-diff/core/active-time";
import { createEstimator, learnFile, normalizeLearned, reviewMinutes, type Estimator } from "@focus-diff/core/estimate";
import { toMatcher, type Matcher } from "@focus-diff/core/filters";
import { browser } from "wxt/browser";

import { i18n } from "#i18n";
import type { ContentScriptContext } from "#imports";
import type { Panel } from "@/components/panel/panel";
import type { Totals } from "@/components/stats/stats";
import { createActiveTime } from "@/utils/active-time/active-time";
import { createStyler, normalizeAppearance } from "@/utils/appearance/appearance";
import { cloneOf } from "@/utils/dom/dom";
import { ALL, filtersFor, normalize, type Config } from "@/utils/filters/filters";
import { formatNumber as format } from "@/utils/format/format";
import type { Message } from "@/utils/messages/messages";
import type { PageCounters, Provider } from "@/utils/provider/provider";
import { collectFiles, type FileInfo, type Files } from "@/utils/review-files/review-files";
import { createNavigation, goToFile } from "@/utils/review-navigation/review-navigation";
import { normalizeReviewTime, type ReviewTimeSettings } from "@/utils/review-sessions/review-sessions";
import { PACES } from "@/utils/review-time/review-time";
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

const IDLE_TIMEOUT_MS = 200;

const show = (element: HTMLElement, visible: boolean) => {
  const display = visible ? "" : "none";
  if (element.style.display !== display) element.style.display = display;
};

const present = (diff: { element: HTMLElement; container: HTMLElement }, visible: boolean, virtualized: boolean) => {
  const hidden = virtualized ? diff.element : diff.container;
  for (const element of new Set([diff.container, diff.element])) show(element, visible || element !== hidden);
};

const COUNTER_COPY = "data-focus-diff-counter";

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

const unmirror = ({ files, additions, deletions }: PageCounters) => {
  for (const counter of [files, additions, deletions]) mirror(counter, null);
};

const updatePageCounters = (provider: Provider, totals: Totals, filtering: boolean) => {
  const counters = provider.counters();
  const number = provider.formatCount;
  if (!filtering) {
    unmirror(counters);
    return;
  }
  mirror(counters.files, `${number(totals.visible)}/${number(totals.total)}`);
  const complete = totals.pending === 0;
  mirror(counters.additions, complete ? `+${number(totals.additions)}` : null);
  mirror(counters.deletions, complete ? `−${number(totals.deletions)}` : null);
};

const restorePage = (provider: Provider) => {
  for (const diff of provider.diffs()) present(diff, true, false);
  provider.closeUp?.([], 0);
  for (const item of provider.tree.files()) show(item.element, true);
  for (const folder of provider.tree.folders()) show(folder.element, true);
  unmirror(provider.counters());
};

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

export const startController = async (
  ctx: ContentScriptContext,
  panel: Panel,
  provider: Provider,
): Promise<Controller> => {
  const restyle = createStyler(panel.setTheme, provider.id);
  await restyle(await loadAppearance());
  let config: Config = await loadConfig();
  let selections: Selections = await selectionsItem.getValue();
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

  const selectedIds = (repo: string) => {
    const matchers = new Map(filters(repo).map((filter) => [filter.id, filter.matches]));
    return (selections[repo] ?? []).filter((id) => {
      const matches = matchers.get(id);
      return Boolean(matches) && hasFiles(matches);
    });
  };

  const loading = () => !files.complete && provider.reportedFileCount() > files.list.length;
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
    if (repo) choose(toggled(selectedIds(repo), id));
  };

  const step = (offset: number) => {
    const repo = provider.repository();
    if (!repo) return;
    const ids = optionsFor(repo)
      .filter((option) => hasFiles(option.matches))
      .map((option) => option.id);
    const index = Math.max(0, ids.indexOf(selectedIds(repo)[0] ?? ALL));
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
    const currentIsNext =
      current && !current.viewed && (current.diff?.container.getBoundingClientRect().top ?? 0) > top + 4;
    const target = currentIsNext ? current : (left.find((file) => shown.indexOf(file) > atTop) ?? first);
    void goToFile(provider, target);
    panel.announceText(i18n.t("panelJumpedToFile", left.length, [target.path, format(left.length)]));
  };

  const activeTime = createActiveTime(ctx, () =>
    provider.diffs().flatMap((diff): OnScreen => {
      const box = diff.container.getBoundingClientRect();
      const height = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
      return height > 0 ? [[diff.path, height]] : [];
    }),
  );
  const MIN_REVIEW_SECONDS = 2;
  let unviewed = { pathname: "", paths: new Set<string>() };
  const learnFromViewed = async (list: FileInfo[]) => {
    if (unviewed.pathname !== location.pathname) unviewed = { pathname: location.pathname, paths: new Set() };
    const marked = list.filter((file) => file.viewed && unviewed.paths.has(file.path));
    for (const file of list) if (!file.viewed) unviewed.paths.add(file.path);
    for (const file of marked) unviewed.paths.delete(file.path);
    if (!reviewTime.learn) return;
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

  let ticket = 0;
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
      chosen = false;
      let undrawn: FileInfo | undefined;
      const behavior = canTransition() ? "instant" : undefined;
      void withTransition(() => {
        apply();
        if (chosen) schedule();
        const next = shown.find((file) => !file.viewed);
        if (next?.diff?.element.isConnected) scrollToTop(next.diff.container, covered, behavior);
        else undrawn = next;
      }, pieces).then(() => {
        if (undrawn) void goToFile(provider, undrawn);
      });
    };
    if (when === "frame" && !document.hidden) ctx.requestAnimationFrame(run);
    else if ("requestIdleCallback" in window) ctx.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else ctx.setTimeout(run, IDLE_TIMEOUT_MS / 4);
  };

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

  apply();
  return { toggle, openSettings, comment, nextUnviewed, dismissUpdate };
};
