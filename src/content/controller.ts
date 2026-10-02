import { i18n } from '#i18n';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import type { Panel } from '@/components/panel/panel';
import { isDone, type Totals } from '@/components/stats/stats';
import { ALL, filtersFor, normalize, toMatcher, type Config, type Matcher } from '@/utils/filters';
import * as page from '@/utils/github';
import type { Message } from '@/utils/messages';
import { configItem, loadConfig, selectionsItem, updateItem, type Selections } from '@/utils/storage';
import { collectFiles, everything, totalsFor, type FileInfo, type Files } from '@/content/files';
import { createNavigation } from '@/content/navigation';

interface Option {
  id: string;
  name: string;
  matches?: Matcher;
}

/** GitHub keeps rendering while a pull request loads; page changes wait for idle time, at most this long. */
const IDLE_TIMEOUT_MS = 200;
const DIMMED_OPACITY = '0.35';

const show = (element: HTMLElement, visible: boolean) => {
  const display = visible ? '' : 'none';
  if (element.style.display !== display) element.style.display = display;
};

/**
 * Filters a rendered diff. In the newer, virtualized list every file keeps an absolute position, so hiding one would
 * leave a gap the size of the file; there, files outside the filter are dimmed instead.
 */
const present = (element: HTMLElement, visible: boolean, virtualized: boolean) => {
  show(element, visible || virtualized);
  const opacity = visible || !virtualized ? '' : DIMMED_OPACITY;
  if (element.style.opacity !== opacity) element.style.opacity = opacity;
};

const COUNTER_COPY = 'data-focus-diff-counter';

/** GitHub's counters use English number formatting whatever the browser language. */
const githubNumber = new Intl.NumberFormat('en-US').format;

/**
 * Shows `value` in place of one of GitHub's counters through a copy beside it, so GitHub keeps updating its own node.
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
    copy = original.cloneNode(false) as HTMLElement;
    copy.removeAttribute('id');
    copy.removeAttribute('title');
    copy.setAttribute(COUNTER_COPY, '');
    original.after(copy);
  }
  if (copy.textContent !== value) copy.textContent = value;
  show(original, false);
};

/** Hides tree files outside the filter, and folders left with nothing to show. */
const filterTree = (matches: Matcher, filtering: boolean, shownPaths: string[], pathByDigest: Map<string, string>) => {
  const folders = new Set<string>();
  const keepFoldersOf = (path: string) => {
    for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) folders.add(path.slice(0, end));
  };
  shownPaths.forEach(keepFoldersOf);
  for (const file of page.treeFiles()) {
    const path = pathByDigest.get(file.digest) ?? page.treePathOf(file.element);
    const visible = matches(path);
    show(file.element, visible);
    if (visible) keepFoldersOf(path);
  }
  for (const folder of page.treeFolders()) show(folder.element, !filtering || folders.has(folder.path));
};

const updatePageCounters = (totals: Totals, filtering: boolean) => {
  const counters = page.pageCounters();
  if (!filtering) {
    Object.values(counters).forEach((counter) => mirror(counter, null));
    return;
  }
  mirror(counters.files, `${githubNumber(totals.visible)}/${githubNumber(totals.total)}`);
  const complete = totals.pending === 0;
  mirror(counters.additions, complete ? `+${githubNumber(totals.additions)}` : null);
  mirror(counters.deletions, complete ? `−${githubNumber(totals.deletions)}` : null);
};

/** Puts the page back the way GitHub drew it. */
const restorePage = () => {
  for (const diff of page.diffs()) present(diff.container, true, false);
  for (const item of page.treeFiles()) show(item.element, true);
  for (const folder of page.treeFolders()) show(folder.element, true);
  Object.values(page.pageCounters()).forEach((counter) => mirror(counter, null));
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
  dismissUpdate: () => void;
}

export const startController = async (ctx: ContentScriptContext, panel: Panel): Promise<Controller> => {
  let config: Config = await loadConfig();
  let selections: Selections = await selectionsItem.getValue();
  let pending: 'frame' | 'idle' | null = null;
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

  const optionsFor = (repo: string): Option[] => [{ id: ALL, name: i18n.t('filterAll') }, ...filters(repo)];

  const selectedIds = (repo: string) => (selections[repo] ?? []).filter((id) => id !== ALL);

  const choose = (ids: string[]) => {
    const repo = page.repository();
    if (!repo || ctx.isInvalid) return;
    selections = { ...selections, [repo]: ids };
    void selectionsItem.setValue(selections);
    announceNext = true;
    schedule();
  };

  const select = (id: string) => choose(id === ALL ? [] : [id]);

  const toggle = (id: string) => {
    const repo = page.repository();
    if (!repo || id === ALL) return select(ALL);
    const current = selectedIds(repo);
    choose(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
  };

  const step = (offset: number) => {
    const repo = page.repository();
    if (!repo) return;
    // Filters with nothing in this pull request are skipped.
    const ids = optionsFor(repo)
      .filter((option) => !option.matches || files.list.some((file) => option.matches?.(file.path)))
      .map((option) => option.id);
    const index = Math.max(0, ids.indexOf(selectedIds(repo)[0] ?? ALL));
    const next = ids[(index + offset + ids.length) % ids.length];
    if (next) select(next);
  };

  const openSettings = () => {
    const repo = page.repository();
    const message: Message = repo && filters(repo).length > 0 ? { type: 'open-options', repo } : { type: 'open-welcome' };
    void browser.runtime.sendMessage(message);
  };

  let pageChanged = false;
  let selectionKey = '';
  /** The selection last seen with files left to review: finishing it is what earns the confetti. */
  let unfinishedKey = '';
  let files: Files = { list: [], complete: false };
  let shown: FileInfo[] = [];
  const navigation = createNavigation(panel, () => schedule());
  const comment = (step: 1 | -1) => void navigation.comment(shown, files.complete, step);

  const apply = () => {
    pending = null;
    if (ctx.isInvalid) return;
    const repo = page.repository();
    observe(Boolean(repo));
    panel.setVisible(Boolean(repo));
    if (!repo) {
      if (pageChanged) restorePage();
      pageChanged = false;
      return;
    }

    const options = optionsFor(repo);
    const ids = selectedIds(repo);
    const selected = options.filter((option) => option.id !== ALL && ids.includes(option.id));
    const filtering = selected.length > 0;
    const matches: Matcher = filtering ? (path) => selected.some((option) => option.matches?.(path)) : everything;
    const selection = filtering ? selected.map((option) => option.id) : [ALL];

    files = collectFiles();
    const reported = page.reportedFileCount();
    const totals = totalsFor(files, matches, reported);
    panel.renderOptions(
      options.map((option) => ({
        ...option,
        count: option.matches ? files.list.filter((file) => option.matches?.(file.path)).length : totals.total,
      })),
      selection,
    );
    const virtualized = page.isVirtualized();
    shown = files.list.filter((file) => matches(file.path));
    for (const file of files.list) if (file.diff) present(file.diff.container, matches(file.path), virtualized);
    filterTree(
      matches,
      filtering,
      shown.map((file) => file.path),
      new Map(files.list.filter((file) => file.digest).map((file) => [file.digest, file.path])),
    );
    // A new pull request or a new selection starts the conversation count over.
    const key = `${location.pathname} ${selection.join()}`;
    if (selectionKey !== key) {
      selectionKey = key;
      navigation.reset();
    }
    panel.renderConversations(navigation.position(shown, files.complete));
    updatePageCounters(totals, filtering);
    pageChanged = filtering;
    panel.renderStats(totals);
    panel.renderBreakdown(
      () => options.map((option) => ({ id: option.id, name: option.name, ...totalsFor(files, option.matches ?? everything, reported) })),
      selection,
    );

    const name = filtering ? selected.map((option) => option.name).join(' + ') : i18n.t('filterAll');
    if (announceNext) {
      announceNext = false;
      panel.announce({ name, ...totals });
    }
    const done = isDone(totals);
    if (done && unfinishedKey === key) panel.celebrate(name);
    unfinishedKey = done ? '' : key;
  };

  /**
   * Reader actions apply on the next frame; changes GitHub makes to the page wait for idle time. A frame request
   * overtakes a pending idle one, which then does nothing.
   */
  let ticket = 0;
  const schedule = (when: 'frame' | 'idle' = 'frame') => {
    if (ctx.isInvalid || pending === 'frame' || pending === when) return;
    pending = when;
    const mine = ++ticket;
    const run = () => mine === ticket && apply();
    if (when === 'frame') ctx.requestAnimationFrame(run);
    // Safari has no requestIdleCallback; a short timeout keeps page changes batched there.
    else if ('requestIdleCallback' in window) ctx.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else ctx.setTimeout(run, IDLE_TIMEOUT_MS / 4);
  };

  const changesElements = (record: MutationRecord) =>
    record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element);

  /** New diffs get filtered on the next frame so they never flash in; text-only changes, like ticking timestamps, are ignored. */
  const pageObserver = new MutationObserver((records) => {
    const relevant = records.filter(changesElements);
    if (!relevant.length) return;
    const urgent = relevant.some((record) => record.type === 'attributes' || [...record.addedNodes].some(page.containsDiff));
    schedule(urgent ? 'frame' : 'idle');
  });
  let observing = false;
  const observe = (active: boolean) => {
    if (active === observing) return;
    observing = active;
    // Viewed toggles flip aria-pressed in the new diff view; the classic one only fires `change` (below).
    if (active)
      pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-pressed'],
      });
    else pageObserver.disconnect();
  };

  const onMessage = (message: Message) => {
    if (message?.type !== 'command') return;
    if (message.command === 'next-filter') step(1);
    if (message.command === 'previous-filter') step(-1);
    if (message.command === 'show-all') select(ALL);
    if (message.command === 'next-comment') comment(1);
    if (message.command === 'previous-comment') comment(-1);
  };
  browser.runtime.onMessage.addListener(onMessage);

  const unwatchConfig = configItem.watch((value) => {
    config = normalize(value);
    schedule();
  });
  const unwatchSelections = selectionsItem.watch((value) => {
    selections = value;
    schedule();
  });
  panel.showUpdate(await updateItem.getValue());
  const unwatchUpdate = updateItem.watch((version) => panel.showUpdate(version));
  const dismissUpdate = () => void updateItem.setValue(null);

  ctx.addEventListener(window, 'wxt:locationchange', () => schedule());
  ctx.addEventListener(document, 'change', () => schedule(), { capture: true });
  ctx.onInvalidated(() => {
    pageObserver.disconnect();
    if (pageChanged) restorePage();
    if (!browser.runtime?.id) return;
    browser.runtime.onMessage.removeListener(onMessage);
    unwatchConfig();
    unwatchSelections();
    unwatchUpdate();
  });

  schedule();
  return { toggle, openSettings, comment, dismissUpdate };
};
