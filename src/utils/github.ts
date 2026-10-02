export interface FileStats {
  additions: number;
  deletions: number;
}

export interface Diff {
  element: Element;
  path: string;
  container: HTMLElement;
  stats: () => FileStats | null;
}

export interface TreeFile {
  element: HTMLElement;
  path: string;
  /** From the item's `#diff-<digest>` link, when the tree has one. */
  digest: string;
}

export interface TreeFolder {
  element: HTMLElement;
  path: string;
  files: HTMLElement[];
}

export interface PageCounters {
  files: HTMLElement | null;
  additions: HTMLElement | null;
  deletions: HTMLElement | null;
}

const DIFF = '[role="region"][id^="diff-"], .file[data-tagsearch-path]';
const TREE_ITEM = '[role="treeitem"]';
const PAGE_LAYOUT = 'main, [role="main"], #diff-comparison-viewer-container, #files';
const PULL_REQUEST_FILES = /^\/([^/]+)\/([^/]+)\/pull\/\d+\/(?:changes|files)(?:\/|$)/;
const FILE_STATS = /(\d[\d,]*)\s+additions?\b.*?(\d[\d,]*)\s+deletions?\b/i;
const ADDITIONS = /^\+[\d,]+$/;
const DELETIONS = /^[−-][\d,]+$/;
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;
const COUNTER_RESCAN_MS = 2000;
const COUNTER_GIVE_UP_MS = 20000;

const toNumber = (value: string) => Number(value.replace(/,/g, ''));
const textOf = (element: Element) => (element.textContent ?? '').trim();
const isLeaf = (element: Element) => element.children.length === 0;

export const repository = (): string | null => {
  const [, owner, name] = location.pathname.match(PULL_REQUEST_FILES) ?? [];
  return owner ? `${owner}/${name}` : null;
};

const cleanPath = (value = '') => {
  const parts = value
    .replace(INVISIBLE, '')
    .trim()
    .split(/\s+→\s+/);
  return (parts.at(-1) ?? '').trim();
};

const pathOf = (diff: HTMLElement) =>
  cleanPath(
    diff.querySelector<HTMLElement>('[data-file-path]')?.dataset.filePath ||
      diff.dataset.tagsearchPath ||
      document.getElementById(diff.getAttribute('aria-labelledby') ?? '')?.textContent ||
      diff.querySelector('h3, [class*="file-name"], a[href^="#diff-"]')?.textContent ||
      '',
  );

const containerOf = (diff: HTMLElement): HTMLElement => {
  let element = diff;
  for (let depth = 0; depth < 4; depth++) {
    const parent = element.parentElement;
    if (!parent || parent === document.body || parent.children.length !== 1 || parent.matches(PAGE_LAYOUT)) break;
    element = parent;
  }
  return element;
};

const labelledStats = (header: Element): FileStats | null => {
  for (const element of header.querySelectorAll('.sr-only, [aria-label], [title]')) {
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '';
    const [, additions, deletions] = (label.length < 160 && label.match(FILE_STATS)) || [];
    if (additions && deletions) return { additions: toNumber(additions), deletions: toNumber(deletions) };
  }
  return null;
};

const visibleStats = (header: Element): FileStats => {
  const leaves = [...header.querySelectorAll('span, div')].filter(isLeaf).map(textOf);
  const additions = leaves.find((value) => ADDITIONS.test(value));
  const deletions = leaves.find((value) => DELETIONS.test(value));
  return { additions: additions ? toNumber(additions.slice(1)) : 0, deletions: deletions ? toNumber(deletions.slice(1)) : 0 };
};

/** Stats survive GitHub unmounting a diff while scrolling. Only labelled stats are kept, and only for the current pull request. */
const statsByPath = new Map<string, FileStats>();
let statsPathname = '';
const statsOf = (diff: Element, path: string): FileStats | null => {
  if (statsPathname !== location.pathname) {
    statsByPath.clear();
    statsPathname = location.pathname;
  }
  const cached = statsByPath.get(path);
  if (cached) return cached;
  const header = diff.querySelector('[data-diff-header-wrapper], .file-header');
  if (!header) return null;
  const labelled = labelledStats(header);
  if (labelled) statsByPath.set(path, labelled);
  return labelled ?? visibleStats(header);
};

/** Paths are cached per element, but only once known, and only while the element keeps its id (GitHub reuses nodes). */
const pathCache = new WeakMap<Element, { id: string; path: string }>();
const cachedPathOf = (element: HTMLElement) => {
  const cached = pathCache.get(element);
  if (cached && cached.id === element.id) return cached.path;
  const path = pathOf(element);
  if (path) pathCache.set(element, { id: element.id, path });
  return path;
};

/** Whether a node GitHub just added is, or contains, a file diff. */
export const containsDiff = (node: Node): boolean => node instanceof Element && (node.matches(DIFF) || node.querySelector(DIFF) !== null);

export const diffs = (): Diff[] => {
  const byPath = new Map<string, Diff>();
  for (const element of document.querySelectorAll<HTMLElement>(DIFF)) {
    if (element.parentElement?.closest(DIFF)) continue;
    const path = cachedPathOf(element);
    if (!path || byPath.has(path)) continue;
    byPath.set(path, { element, path, container: containerOf(element), stats: () => statsOf(element, path) });
  }
  return [...byPath.values()];
};

const labelOf = (item: Element) => (item.querySelector(':scope > div')?.textContent || item.getAttribute('aria-label') || '').trim();

const folderPathOf = (item: Element | null | undefined): string => {
  const parts: string[] = [];
  for (let folder = item; folder; folder = folder.parentElement?.closest(TREE_ITEM)) {
    parts.unshift(labelOf(folder).split(/\s/)[0] ?? '');
  }
  return parts.join('/');
};

const treePathOf = (item: Element) => {
  const label = labelOf(item);
  const name = label.match(/[^\s/]+\.[A-Za-z0-9]+/)?.[0] ?? label;
  const folder = folderPathOf(item.parentElement?.closest(TREE_ITEM));
  return folder ? `${folder}/${name}` : name;
};

export const treeFiles = (): TreeFile[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}:not([aria-expanded])`)].map((element) => ({
    element,
    path: treePathOf(element),
    digest: element.querySelector('a[href^="#diff-"]')?.getAttribute('href')?.slice('#diff-'.length) ?? '',
  }));

export const treeFolders = (): TreeFolder[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}[aria-expanded]`)].map((element) => ({
    element,
    path: folderPathOf(element),
    files: [...element.querySelectorAll<HTMLElement>(`${TREE_ITEM}:not([aria-expanded])`)],
  }));

const findFilesCounter = (): HTMLElement | null =>
  document.getElementById('files_tab_counter') ||
  [...document.querySelectorAll('a, [role="tab"]')]
    .find((element) => /^\s*Files changed/i.test(element.textContent ?? ''))
    ?.querySelector<HTMLElement>('.Counter, [class*="Counter"]') ||
  null;

const findLineCounters = (): [HTMLElement | null, HTMLElement | null] => {
  const summary = document.getElementById('diffstat');
  if (summary) return [summary.querySelector<HTMLElement>('.color-fg-success'), summary.querySelector<HTMLElement>('.color-fg-danger')];

  const additions = [...document.querySelectorAll<HTMLElement>('span, div')].find(
    (element) => isLeaf(element) && ADDITIONS.test(textOf(element)) && !element.closest(`${DIFF}, [role="tree"]`),
  );
  if (!additions) return [null, null];
  const near = additions.parentElement?.parentElement ?? additions.parentElement;
  const deletions = [...(near?.querySelectorAll<HTMLElement>('span, div') ?? [])].find(
    (element) => isLeaf(element) && DELETIONS.test(textOf(element)),
  );
  return [additions, deletions ?? null];
};

let counters: PageCounters = { files: null, additions: null, deletions: null };
let scannedAt = 0;
let firstScanAt = 0;
let scannedPathname = '';

/** GitHub's own counters. The full-page search runs at most every couple of seconds, and gives up on a page after a while. */
export const pageCounters = (): PageCounters => {
  if (counters.files?.isConnected && counters.additions?.isConnected) return counters;
  const now = Date.now();
  if (scannedPathname !== location.pathname) {
    scannedPathname = location.pathname;
    firstScanAt = now;
  } else if (now - scannedAt < COUNTER_RESCAN_MS || now - firstScanAt > COUNTER_GIVE_UP_MS) {
    return counters;
  }
  scannedAt = now;
  const [additions, deletions] = findLineCounters();
  counters = { files: findFilesCounter(), additions, deletions };
  return counters;
};

/** The number of changed files GitHub reports, which counts files it hasn't rendered yet. */
export const reportedFileCount = (): number => {
  const text = pageCounters().files?.textContent ?? '';
  return Number(text.replace(/[^\d]/g, '')) || 0;
};

const VIEWED =
  'input.js-reviewed-checkbox, button[class*="MarkAsViewedButton"], [data-diff-header-wrapper] button[aria-pressed], [data-diff-header-wrapper] input[type="checkbox"]';
const VIEWED_LABEL = /viewed/i;

/** Whether the reviewer marked a file as viewed on GitHub, or `null` when its toggle isn't rendered. */
export const viewed = (diff: Pick<Diff, 'element'>): boolean | null => {
  for (const control of diff.element.querySelectorAll<HTMLElement>(VIEWED)) {
    const label = control.matches('.js-reviewed-checkbox, [class*="MarkAsViewedButton"]')
      ? 'viewed'
      : `${control.getAttribute('aria-label') ?? ''} ${control.closest('label')?.textContent ?? ''} ${control.textContent ?? ''}`;
    if (!VIEWED_LABEL.test(label)) continue;
    return control instanceof HTMLInputElement ? control.checked : control.getAttribute('aria-pressed') === 'true';
  }
  return null;
};

/** The newer diff view positions each file absolutely in a tall list and only renders the ones near the screen. */
export const isVirtualized = (): boolean => document.querySelector('[data-index][data-path-digest][style*="top"]') !== null;

export const diffByDigest = (digest: string): HTMLElement | null => (digest ? document.getElementById(`diff-${digest}`) : null);

/** The file tree's link to a file, which makes GitHub scroll to it and render it. */
export const treeLink = (digest: string): HTMLAnchorElement | null =>
  digest ? document.querySelector<HTMLAnchorElement>(`[role="treeitem"] a[href="#diff-${CSS.escape(digest)}"]`) : null;

/** Conversation markers beside the lines of a rendered diff in the newer view, top to bottom. */
export const commentIndicators = (diff: Element): HTMLElement[] =>
  [...diff.querySelectorAll<HTMLElement>('[class*="CommentIndicator-module__commentIn"]')].toSorted(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  );

/** Review conversations: classic `review-thread-collapsible` threads, plus likely markers from the newer diff view. */
const THREAD =
  '.js-resolvable-timeline-thread-container, .review-thread-component, [data-testid*="review-thread" i], [class*="ReviewThread"]';

export interface Thread {
  element: HTMLElement;
  resolved: boolean;
}

/** Conversations inside the given diffs, in page order. */
export const threads = (containers: HTMLElement[]): Thread[] =>
  containers
    .flatMap((container) => [...container.querySelectorAll<HTMLElement>(THREAD)])
    .filter(
      (element, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains(element) && other !== element),
    )
    .map((element) => ({ element, resolved: element.dataset.resolved === 'true' }));

const STICKY_OFFSET_PX = 80;
const FLASH_MS = 1600;

const scrollBehavior = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'auto');

/** Scrolls an element to the top of the page, below GitHub's sticky headers. */
export const scrollToTop = (element: Element): void => {
  const top = element.getBoundingClientRect().top + scrollY - STICKY_OFFSET_PX;
  scrollTo({ top, behavior: scrollBehavior() });
};

/** Scrolls an element to the middle of the screen. */
export const scrollToCenter = (element: Element): void => {
  const box = element.getBoundingClientRect();
  scrollTo({ top: box.top + scrollY - Math.max(STICKY_OFFSET_PX, (innerHeight - box.height) / 2), behavior: scrollBehavior() });
};

/** Outlines an element for a moment so the eye finds it after a jump. */
export const flash = (element: HTMLElement): void => {
  const { outline, outlineOffset, borderRadius } = element.style;
  element.style.outline = '2px solid var(--focus-outlineColor, var(--color-accent-fg, #0969da))';
  element.style.outlineOffset = '2px';
  element.style.borderRadius ||= '6px';
  setTimeout(() => Object.assign(element.style, { outline, outlineOffset, borderRadius }), FLASH_MS);
};
