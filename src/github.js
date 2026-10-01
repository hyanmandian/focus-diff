var GitHubPage = (() => {
  const DIFF = '[role="region"][id^="diff-"], .file[data-tagsearch-path]';
  const TREE_ITEM = '[role="treeitem"]';
  const PAGE_LAYOUT = 'main, [role="main"], #diff-comparison-viewer-container, #files';
  const PULL_REQUEST_FILES = /^\/([^/]+)\/([^/]+)\/pull\/\d+\/(?:changes|files)(?:\/|$)/;
  const FILE_STATS = /(\d[\d,]*)\s+additions?\b.*?(\d[\d,]*)\s+deletions?\b/i;
  const ADDITIONS = /^\+[\d,]+$/;
  const DELETIONS = /^[−-][\d,]+$/;
  const COUNTER_RESCAN_MS = 2000;

  const toNumber = (text) => Number(text.replace(/,/g, ''));
  const text = (element) => element.textContent.trim();

  const repository = () => {
    const [, owner, name] = location.pathname.match(PULL_REQUEST_FILES) ?? [];
    return owner ? `${owner}/${name}` : null;
  };

  const pathOf = (diff) =>
    diff.querySelector('[data-file-path]')?.dataset.filePath ||
    diff.dataset.tagsearchPath ||
    document.getElementById(diff.getAttribute('aria-labelledby'))?.textContent.trim() ||
    '';

  const containerOf = (diff) => {
    let element = diff;
    for (let depth = 0; depth < 4; depth++) {
      const parent = element.parentElement;
      if (!parent || parent === document.body || parent.children.length !== 1 || parent.matches(PAGE_LAYOUT)) break;
      element = parent;
    }
    return element;
  };

  const statsCache = new WeakMap();
  const statsOf = (diff) => {
    if (statsCache.has(diff)) return statsCache.get(diff);
    const header = diff.querySelector('[data-diff-header-wrapper], .file-header') ?? diff;
    for (const element of header.querySelectorAll('.sr-only, [aria-label], [title]')) {
      const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent;
      const [, additions, deletions] = (label.length < 160 && label.match(FILE_STATS)) || [];
      if (additions) {
        const stats = { additions: toNumber(additions), deletions: toNumber(deletions) };
        statsCache.set(diff, stats);
        return stats;
      }
    }
    return null;
  };

  const diffs = () =>
    [...document.querySelectorAll(DIFF)]
      .map((element) => ({ element, path: pathOf(element), container: containerOf(element), stats: () => statsOf(element) }))
      .filter((diff) => diff.path);

  const labelOf = (item) => (item.querySelector(':scope > div')?.textContent || item.getAttribute('aria-label') || '').trim();

  const treePathOf = (item) => {
    const label = labelOf(item);
    const parts = [label.match(/[^\s/]+\.[A-Za-z0-9]+/)?.[0] ?? label];
    for (let folder = item.parentElement?.closest(TREE_ITEM); folder; folder = folder.parentElement?.closest(TREE_ITEM)) {
      parts.unshift(labelOf(folder).split(/\s/)[0]);
    }
    return parts.join('/');
  };

  const treeFiles = () =>
    [...document.querySelectorAll(`${TREE_ITEM}:not([aria-expanded])`)].map((element) => ({ element, path: treePathOf(element) }));

  const treeFolders = () =>
    [...document.querySelectorAll(`${TREE_ITEM}[aria-expanded]`)].map((element) => ({
      element,
      files: [...element.querySelectorAll(`${TREE_ITEM}:not([aria-expanded])`)],
    }));

  const findFilesCounter = () =>
    document.getElementById('files_tab_counter') ||
    [...document.querySelectorAll('a, [role="tab"]')]
      .find((element) => /^\s*Files changed/i.test(element.textContent))
      ?.querySelector('.Counter, [class*="Counter"]') ||
    null;

  const findLineCounters = () => {
    const summary = document.getElementById('diffstat');
    if (summary) return [summary.querySelector('.color-fg-success'), summary.querySelector('.color-fg-danger')];

    const deletionsNextTo = (element) => [...element.parentElement.children].find((sibling) => DELETIONS.test(text(sibling)));
    const additions = [...document.querySelectorAll('span, div')].find(
      (element) =>
        !element.children.length &&
        ADDITIONS.test(text(element)) &&
        !element.closest(`${DIFF}, [role="tree"]`) &&
        deletionsNextTo(element),
    );
    return additions ? [additions, deletionsNextTo(additions)] : [null, null];
  };

  let counters = { files: null, additions: null, deletions: null };
  let scannedAt = 0;
  const pageCounters = () => {
    const connected = Object.values(counters).every((element) => element?.isConnected);
    if (connected || Date.now() - scannedAt < COUNTER_RESCAN_MS) return counters;
    scannedAt = Date.now();
    const [additions, deletions] = findLineCounters();
    counters = { files: findFilesCounter(), additions, deletions };
    return counters;
  };

  return { repository, diffs, treeFiles, treeFolders, pageCounters };
})();
