import { i18n } from '#i18n';
import type { ContentScriptContext } from '#imports';
import { browser } from 'wxt/browser';
import type { Panel, Totals } from '@/components/panel';
import { ALL, filtersFor, normalize, toMatcher, type Config, type Matcher } from '@/utils/filters';
import { formatNumber as format } from '@/utils/format';
import * as page from '@/utils/github';
import type { FileStats } from '@/utils/github';
import type { Message } from '@/utils/messages';
import { configItem, loadConfig, selectionsItem, type Selections } from '@/utils/storage';

interface Option {
  id: string;
  name: string;
  matches?: Matcher;
}

interface LoadedDiff {
  path: string;
  container: HTMLElement;
  stats: FileStats | null;
}

const APPLY_DELAY_MS = 50;
const everything: Matcher = () => true;

const show = (element: HTMLElement, visible: boolean) => {
  const display = visible ? '' : 'none';
  if (element.style.display !== display) element.style.display = display;
};

const overwrite = (element: HTMLElement | null, value: string) => {
  if (!element) return;
  element.dataset.focusDiffOriginal ??= element.textContent ?? '';
  if (element.textContent !== value) element.textContent = value;
};

const restore = (element: HTMLElement | null) => {
  if (!element || element.dataset.focusDiffOriginal === undefined) return;
  if (element.textContent !== element.dataset.focusDiffOriginal) element.textContent = element.dataset.focusDiffOriginal;
  delete element.dataset.focusDiffOriginal;
};

const totalsFor = (diffs: LoadedDiff[], matches: Matcher): Totals => {
  const totals = { visible: 0, total: diffs.length, additions: 0, deletions: 0, pending: 0 };
  for (const diff of diffs) {
    if (!matches(diff.path)) continue;
    totals.visible++;
    if (!diff.stats) totals.pending++;
    totals.additions += diff.stats?.additions ?? 0;
    totals.deletions += diff.stats?.deletions ?? 0;
  }
  return totals;
};

const filterTree = (matches: Matcher, filtering: boolean) => {
  for (const file of page.treeFiles()) show(file.element, matches(file.path));
  for (const folder of page.treeFolders()) {
    show(folder.element, !filtering || folder.files.length === 0 || folder.files.some((file) => file.style.display !== 'none'));
  }
};

const updatePageCounters = (totals: Totals, filtering: boolean) => {
  const counters = page.pageCounters();
  if (!filtering) {
    Object.values(counters).forEach(restore);
    return;
  }
  overwrite(counters.files, `${format(totals.visible)}/${format(totals.total)}`);
  if (totals.pending > 0) {
    restore(counters.additions);
    restore(counters.deletions);
    return;
  }
  overwrite(counters.additions, `+${format(totals.additions)}`);
  overwrite(counters.deletions, `−${format(totals.deletions)}`);
};

export interface Controller {
  select: (id: string) => void;
  toggle: (id: string) => void;
  openSettings: () => void;
}

export const startController = async (ctx: ContentScriptContext, panel: Panel): Promise<Controller> => {
  let config: Config = await loadConfig();
  let selections: Selections = await selectionsItem.getValue();
  let scheduled = false;
  let announceNext = false;

  const filters = (repo: string) =>
    filtersFor(config, repo)
      .map((filter) => ({ ...filter, matches: toMatcher(filter) ?? undefined }))
      .filter((filter) => filter.name && filter.matches);

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

  const apply = () => {
    scheduled = false;
    if (ctx.isInvalid) return;
    const repo = page.repository();
    observe(Boolean(repo));
    panel.setVisible(Boolean(repo));
    if (!repo) return;

    const options = optionsFor(repo);
    const ids = selectedIds(repo);
    const selected = options.filter((option) => option.id !== ALL && ids.includes(option.id));
    const filtering = selected.length > 0;
    const matches: Matcher = filtering ? (path) => selected.some((option) => option.matches?.(path)) : everything;
    const selection = filtering ? selected.map((option) => option.id) : [ALL];

    const diffs: LoadedDiff[] = page.diffs().map((diff) => ({ path: diff.path, container: diff.container, stats: diff.stats() }));
    const totals = totalsFor(diffs, matches);
    panel.renderOptions(options, selection);
    for (const diff of diffs) show(diff.container, matches(diff.path));
    filterTree(matches, filtering);
    updatePageCounters(totals, filtering);
    panel.renderStats(totals);
    panel.renderBreakdown(
      options.map((option) => ({ id: option.id, name: option.name, ...totalsFor(diffs, option.matches ?? everything) })),
      selection,
    );

    if (announceNext) {
      announceNext = false;
      const name = filtering ? selected.map((option) => option.name).join(' + ') : i18n.t('filterAll');
      panel.announce({ name, ...totals });
    }
  };

  const schedule = () => {
    if (scheduled || ctx.isInvalid) return;
    scheduled = true;
    ctx.setTimeout(apply, APPLY_DELAY_MS);
  };

  const pageObserver = new MutationObserver(schedule);
  let observing = false;
  const observe = (active: boolean) => {
    if (active === observing) return;
    observing = active;
    if (active) pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    else pageObserver.disconnect();
  };

  const onMessage = (message: Message) => {
    if (message?.type !== 'command') return;
    if (message.command === 'next-filter') step(1);
    if (message.command === 'previous-filter') step(-1);
    if (message.command === 'show-all') select(ALL);
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

  ctx.addEventListener(window, 'wxt:locationchange', schedule);
  ctx.onInvalidated(() => {
    pageObserver.disconnect();
    if (!browser.runtime?.id) return;
    browser.runtime.onMessage.removeListener(onMessage);
    unwatchConfig();
    unwatchSelections();
  });

  schedule();
  return { select, toggle, openSettings };
};
