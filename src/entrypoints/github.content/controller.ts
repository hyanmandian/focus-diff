import { i18n } from '#i18n';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import type { Panel, Totals } from '@/components/panel';
import { ALL, filtersFor, normalize, toMatcher, type Config, type Matcher } from '@/utils/filters';
import * as page from '@/utils/github';
import type { Message } from '@/utils/messages';
import { configItem, loadConfig, selectionsItem, type Selections } from '@/utils/storage';
import { collectFiles, everything, totalsFor, type FileInfo, type Files } from './files';
import { createNavigation } from './navigation';

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

const filterTree = (matches: Matcher, filtering: boolean, visiblePaths: string[], pathByDigest: Map<string, string>) => {
  const files = page.treeFiles().map((file) => ({ ...file, path: pathByDigest.get(file.digest) ?? file.path }));
  for (const file of files) show(file.element, matches(file.path));
  const shown = [...visiblePaths, ...files.filter((file) => file.element.style.display !== 'none').map((file) => file.path)];
  for (const folder of page.treeFolders()) {
    const prefix = `${folder.path}/`;
    show(
      folder.element,
      !filtering || shown.some((path) => path.startsWith(prefix)) || folder.files.some((file) => file.style.display !== 'none'),
    );
  }
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
  select: (id: string) => void;
  toggle: (id: string) => void;
  openSettings: () => void;
  nextUnviewed: () => void;
  comment: (step: 1 | -1) => void;
  goToComment: (index: number) => void;
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
    const ids = optionsFor(repo).map((option) => option.id);
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
  let files: Files = { list: [], complete: false };
  let shown: FileInfo[] = [];
  const navigation = createNavigation(panel, () => schedule());
  const nextUnviewed = () => void navigation.nextUnviewed(shown);
  const comment = (step: 1 | -1) => void navigation.comment(shown, files.complete, step);
  const goToComment = (index: number) => void navigation.goTo(shown, files.complete, index);

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
    if (selectionKey !== selection.join()) {
      selectionKey = selection.join();
      navigation.reset();
    }
    panel.renderNavigation({ unviewed: shown.filter((file) => !file.viewed).length, comments: navigation.position(shown, files.complete) });
    updatePageCounters(totals, filtering);
    pageChanged = filtering;
    panel.renderStats(totals);
    panel.renderBreakdown(
      () => options.map((option) => ({ id: option.id, name: option.name, ...totalsFor(files, option.matches ?? everything, reported) })),
      selection,
    );

    if (announceNext) {
      announceNext = false;
      const name = filtering ? selected.map((option) => option.name).join(' + ') : i18n.t('filterAll');
      panel.announce({ name, ...totals });
    }
  };

  /** Reader actions apply on the next frame; changes GitHub makes to the page wait for idle time. */
  const schedule = (when: 'frame' | 'idle' = 'frame') => {
    if (ctx.isInvalid || pending === 'frame' || pending === when) return;
    pending = when;
    if (when === 'frame') ctx.requestAnimationFrame(apply);
    else ctx.requestIdleCallback(apply, { timeout: IDLE_TIMEOUT_MS });
  };

  /** New diffs get filtered on the next frame so they never flash in; any other change waits for idle time. */
  const pageObserver = new MutationObserver((records) => {
    const urgent = records.some((record) => record.type === 'attributes' || [...record.addedNodes].some(page.containsDiff));
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
    if (message.command === 'next-unviewed') nextUnviewed();
    if (message.command === 'next-comment') comment(1);
    if (message.command === 'previous-comment') comment(-1);
  };
  browser.runtime.onMessage.addListener(onMessage);

  const unwatchConfig = configItem.watch((value) => {
    config = normalize(value);
    panel.reset();
    schedule();
  });
  const unwatchSelections = selectionsItem.watch((value) => {
    selections = value;
    schedule();
  });

  ctx.addEventListener(window, 'wxt:locationchange', () => schedule());
  ctx.addEventListener(document, 'change', () => schedule(), { capture: true });
  ctx.onInvalidated(() => {
    pageObserver.disconnect();
    if (pageChanged) restorePage();
    if (!browser.runtime?.id) return;
    browser.runtime.onMessage.removeListener(onMessage);
    unwatchConfig();
    unwatchSelections();
  });

  schedule();
  return { select, toggle, openSettings, nextUnviewed, comment, goToComment };
};
