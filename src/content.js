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

  const selectedIds = (repo) => [activeByRepo[repo] ?? []].flat().filter((id) => id !== ALL);

  const choose = (ids) => {
    if (!extensionAlive()) return shutDown();
    const repo = page.repository();
    if (!repo) return;
    activeByRepo = { ...activeByRepo, [repo]: ids };
    chrome.storage.local.set({ active: activeByRepo });
    announceNext = true;
    schedule();
  };

  const select = (id) => choose(id === ALL ? [] : [id]);

  const toggle = (id) => {
    const repo = page.repository();
    if (!repo || id === ALL) return select(ALL);
    const current = selectedIds(repo);
    choose(current.includes(id) ? current.filter((other) => other !== id) : [...current, id]);
  };

  const step = (offset) => {
    const repo = page.repository();
    if (!repo) return;
    const ids = optionsFor(repo).map((option) => option.id);
    const index = Math.max(0, ids.indexOf(selectedIds(repo)[0] ?? ALL));
    select(ids[(index + offset + ids.length) % ids.length]);
  };

  const panel = FocusDiffPanel.create({
    onSelect: select,
    onToggle: toggle,
    onSettings: () => {
      const repo = page.repository();
      const configured = repo && filtersFor(repo).length > 0;
      chrome.runtime.sendMessage(configured ? { type: 'open-options', repo } : { type: 'open-welcome' });
    },
  });

  const everything = () => true;

  const totalsFor = (diffs, matches) => {
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

  const filterDiffs = (diffs, matches) => {
    for (const diff of diffs) show(diff.container, matches(diff.path));
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

  const extensionAlive = () => Boolean(chrome.runtime?.id);

  const shutDown = () => {
    pageObserver.disconnect();
    panel.remove();
  };

  const apply = () => {
    scheduled = false;
    if (!extensionAlive()) return shutDown();
    const repo = page.repository();
    observePage(Boolean(repo));
    panel.setVisible(Boolean(repo));
    if (!repo) return;

    const options = optionsFor(repo);
    const ids = selectedIds(repo);
    const selected = options.filter((option) => option.id !== ALL && ids.includes(option.id));
    const filtering = selected.length > 0;
    const matches = filtering ? (path) => selected.some((option) => option.matches(path)) : everything;
    const selection = filtering ? selected.map((option) => option.id) : [ALL];

    const diffs = page.diffs().map((diff) => ({ path: diff.path, container: diff.container, stats: diff.stats() }));
    const totals = totalsFor(diffs, matches);
    panel.renderOptions(options, selection);
    filterDiffs(diffs, matches);
    filterTree(matches, filtering);
    updatePageCounters(totals, filtering);
    panel.renderStats(totals);
    panel.renderBreakdown(
      options.map((option) => ({ id: option.id, name: option.name, ...totalsFor(diffs, option.matches ?? everything) })),
      selection,
    );

    if (announceNext) {
      announceNext = false;
      const name = filtering ? selected.map((option) => option.name).join(' + ') : t('filterAll');
      panel.announce({ name, ...totals });
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
