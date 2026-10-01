(() => {
  const { ALL, formatNumber: format, t } = FocusDiff;
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

  const optionsFor = (repo) => [{ id: ALL, name: t('filterAll') }, ...filtersFor(repo)];

  const select = (id) => {
    const repo = page.repository();
    if (!repo) return;
    activeByRepo = { ...activeByRepo, [repo]: id };
    chrome.storage.local.set({ active: activeByRepo });
    announceNext = true;
    schedule();
  };

  const step = (offset) => {
    const repo = page.repository();
    if (!repo) return;
    const ids = optionsFor(repo).map((option) => option.id);
    const index = Math.max(0, ids.indexOf(activeByRepo[repo] ?? ALL));
    select(ids[(index + offset + ids.length) % ids.length]);
  };

  const panel = FocusDiffPanel.create({
    onSelect: select,
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

  const pageObserver = new MutationObserver(() => schedule());
  let observing = false;

  const observePage = (active) => {
    if (active === observing) return;
    observing = active;
    if (active) pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    else pageObserver.disconnect();
  };

  const apply = () => {
    scheduled = false;
    const repo = page.repository();
    observePage(Boolean(repo));
    panel.setVisible(Boolean(repo));
    if (!repo) return;

    const options = optionsFor(repo);
    const current = options.find((option) => option.id !== ALL && option.id === activeByRepo[repo]);
    const matches = current?.matches ?? (() => true);

    panel.renderOptions(options, current?.id ?? ALL);
    const totals = filterDiffs(matches);
    filterTree(matches, Boolean(current));
    updatePageCounters(totals, Boolean(current));
    panel.renderStats(totals);

    if (announceNext) {
      announceNext = false;
      panel.announce({ name: current?.name ?? t('filterAll'), ...totals });
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 50);
  };

  const watchNavigation = () => {
    let href = location.href;
    const check = () => {
      if (location.href === href) return;
      href = location.href;
      schedule();
    };
    window.navigation?.addEventListener('navigatesuccess', check);
    ['turbo:load', 'turbo:render'].forEach((type) => document.addEventListener(type, check));
    ['popstate', 'pageshow'].forEach((type) => window.addEventListener(type, check));
    new MutationObserver(check).observe(document.head, { childList: true, subtree: true, characterData: true });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.config) config = FocusDiff.normalize(changes.config.newValue);
    if (area === 'local' && changes.active) activeByRepo = changes.active.newValue ?? {};
    panel.reset();
    schedule();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'command') return;
    if (message.command === 'next-filter') step(1);
    if (message.command === 'previous-filter') step(-1);
    if (message.command === 'show-all') select(ALL);
  });

  Promise.all([FocusDiff.load(), chrome.storage.local.get('active')]).then(([loaded, { active }]) => {
    config = loaded;
    activeByRepo = active ?? {};
    watchNavigation();
    schedule();
  });
})();
