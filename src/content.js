(() => {
  const { ALL, formatNumber: format } = FocusDiff;
  const page = GitHubPage;

  let config = FocusDiff.normalize({});
  let activeByRepo = {};
  let scheduled = false;
  let announceNext = false;

  const show = (element, visible) => {
    const display = visible ? '' : 'none';
    if (element.style.display !== display) element.style.display = display;
  };

  const overwrite = (element, value) => {
    if (!element) return;
    element.dataset.focusDiffOriginal ??= element.textContent;
    if (element.textContent !== value) element.textContent = value;
  };

  const restore = (element) => {
    if (!element || element.dataset.focusDiffOriginal === undefined) return;
    if (element.textContent !== element.dataset.focusDiffOriginal) element.textContent = element.dataset.focusDiffOriginal;
    delete element.dataset.focusDiffOriginal;
  };

  const filtersFor = (repo) =>
    FocusDiff.filtersFor(config, repo)
      .map((filter) => ({ ...filter, matches: FocusDiff.toMatcher(filter) }))
      .filter((filter) => filter.name && filter.matches);

  const panel = FocusDiffPanel.create({
    onSelect: (id) => {
      const repo = page.repository();
      if (!repo) return;
      activeByRepo = { ...activeByRepo, [repo]: id };
      chrome.storage.local.set({ active: activeByRepo });
      announceNext = true;
      schedule();
    },
    onSettings: () => chrome.runtime.sendMessage({ type: 'open-options', repo: page.repository() }),
  });

  const filterDiffs = (matches) => {
    const totals = { visible: 0, total: 0, additions: 0, deletions: 0, pending: 0 };
    for (const diff of page.diffs()) {
      totals.total++;
      const keep = matches(diff.path);
      show(diff.container, keep);
      if (!keep) continue;
      totals.visible++;
      const stats = diff.stats();
      if (!stats) totals.pending++;
      totals.additions += stats?.additions ?? 0;
      totals.deletions += stats?.deletions ?? 0;
    }
    return totals;
  };

  const filterTree = (matches, filtering) => {
    for (const file of page.treeFiles()) show(file.element, matches(file.path));
    for (const folder of page.treeFolders()) {
      show(folder.element, !filtering || folder.files.length === 0 || folder.files.some((file) => file.style.display !== 'none'));
    }
  };

  const updatePageCounters = (totals, filtering) => {
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

  const apply = () => {
    scheduled = false;
    const repo = page.repository();
    panel.setVisible(Boolean(repo));
    if (!repo) return;

    const filters = filtersFor(repo);
    const current = filters.find((filter) => filter.id === activeByRepo[repo]);
    const matches = current?.matches ?? (() => true);

    panel.renderOptions([{ id: ALL, name: 'All' }, ...filters], current?.id ?? ALL);
    const totals = filterDiffs(matches);
    filterTree(matches, Boolean(current));
    updatePageCounters(totals, Boolean(current));
    panel.renderStats(totals);

    if (announceNext) {
      announceNext = false;
      panel.announce({ name: current?.name ?? 'All', ...totals });
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 50);
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.config) config = FocusDiff.normalize(changes.config.newValue);
    if (area === 'local' && changes.active) activeByRepo = changes.active.newValue ?? {};
    panel.reset();
    schedule();
  });

  Promise.all([FocusDiff.load(), chrome.storage.local.get('active')]).then(([loaded, { active }]) => {
    config = loaded;
    activeByRepo = active ?? {};
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    ['turbo:load', 'turbo:render'].forEach((type) => document.addEventListener(type, schedule));
    ['popstate', 'pageshow'].forEach((type) => window.addEventListener(type, schedule));
    schedule();
  });
})();
