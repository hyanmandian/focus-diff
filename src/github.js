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

  const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;

  const cleanPath = (value = '') => {
    const parts = value.replace(INVISIBLE, '').trim().split(/\s+→\s+/);
    return parts[parts.length - 1].trim();
  };

  const pathOf = (diff) =>
    cleanPath(
      diff.querySelector('[data-file-path]')?.dataset.filePath ||
        diff.dataset.tagsearchPath ||
        document.getElementById(diff.getAttribute('aria-labelledby'))?.textContent ||
        diff.querySelector('h3, [class*="file-name"], a[href^="#diff-"]')?.textContent,
    );

  const containerOf = (diff) => {
    let element = diff;
    for (let depth = 0; depth < 4; depth++) {
      const parent = element.parentElement;
      if (!parent || parent === document.body || parent.children.length !== 1 || parent.matches(PAGE_LAYOUT)) break;
      element = parent;
    }
    return element;
  };

  const labelledStats = (header) => {
    for (const element of header.querySelectorAll('.sr-only, [aria-label], [title]')) {
      const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent;
      const [, additions, deletions] = (label.length < 160 && label.match(FILE_STATS)) || [];
      if (additions) return { additions: toNumber(additions), deletions: toNumber(deletions) };
    }
    return null;
  };

  const visibleStats = (header) => {
    const leaves = [...header.querySelectorAll('span, div')].filter((element) => !element.children.length).map(text);
    const additions = leaves.find((value) => ADDITIONS.test(value));
    const deletions = leaves.find((value) => DELETIONS.test(value));
    return { additions: additions ? toNumber(additions.slice(1)) : 0, deletions: deletions ? toNumber(deletions.slice(1)) : 0 };
  };

  const statsByPath = new Map();
  const statsOf = (diff, path) => {
    const key = `${location.pathname}|${path}`;
    if (statsByPath.has(key)) return statsByPath.get(key);
    const header = diff.querySelector('[data-diff-header-wrapper], .file-header');
    if (!header) return null;
    const stats = labelledStats(header) ?? visibleStats(header);
    statsByPath.set(key, stats);
    return stats;
  };

  const pathCache = new WeakMap();
  const cachedPathOf = (element) => {
    if (!pathCache.has(element)) pathCache.set(element, pathOf(element));
    return pathCache.get(element);
  };

  const diffs = () => {
    const byPath = new Map();
    for (const element of document.querySelectorAll(DIFF)) {
      if (element.parentElement?.closest(DIFF)) continue;
      const path = cachedPathOf(element);
      if (!path || byPath.has(path)) continue;
      byPath.set(path, { element, path, container: containerOf(element), stats: () => statsOf(element, path) });
    }
    return [...byPath.values()];
  };

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

    const isLeaf = (element) => !element.children.length;
    const additions = [...document.querySelectorAll('span, div')].find(
      (element) => isLeaf(element) && ADDITIONS.test(text(element)) && !element.closest(`${DIFF}, [role="tree"]`),
    );
    if (!additions) return [null, null];
    const near = additions.parentElement?.parentElement ?? additions.parentElement;
    const deletions = [...near.querySelectorAll('span, div')].find((element) => isLeaf(element) && DELETIONS.test(text(element)));
    return [additions, deletions ?? null];
  };

  let counters = { files: null, additions: null, deletions: null };
  let scannedAt = 0;
  const pageCounters = () => {
    const connected = counters.files?.isConnected && counters.additions?.isConnected;
    if (connected || Date.now() - scannedAt < COUNTER_RESCAN_MS) return counters;
    scannedAt = Date.now();
    const [additions, deletions] = findLineCounters();
    counters = { files: findFilesCounter(), additions, deletions };
    return counters;
  };

  return { repository, diffs, treeFiles, treeFolders, pageCounters };
})();
