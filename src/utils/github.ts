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
}

export interface TreeFolder {
  element: HTMLElement;
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
const PULL_REQUEST_FILES = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/|$)/;
const VIEWED = 'input.js-reviewed-checkbox, [data-diff-header-wrapper] button[aria-pressed]';
const FLASH_MS = 1600;
const FILE_STATS = /(\d[\d,]*)\s+additions?\b.*?(\d[\d,]*)\s+deletions?\b/i;
const ADDITIONS = /^\+[\d,]+$/;
const DELETIONS = /^[−-][\d,]+$/;
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;
const COUNTER_RESCAN_MS = 2000;

const toNumber = (value: string) => Number(value.replace(/,/g, ''));
const textOf = (element: Element) => (element.textContent ?? '').trim();
const isLeaf = (element: Element) => element.children.length === 0;

export const repository = (): string | null => {
  const [, owner, name] = location.pathname.match(PULL_REQUEST_FILES) ?? [];
  return owner ? `${owner}/${name}` : null;
};

export const pullRequest = (): { repo: string; number: number } | null => {
  const [, owner, name, number] = location.pathname.match(PULL_REQUEST_FILES) ?? [];
  return owner ? { repo: `${owner}/${name}`, number: Number(number) } : null;
};

export const title = (): string => {
  const heading = document.querySelector('.js-issue-title, [data-component="PH_Title"] bdi, h1 bdi');
  if (heading?.textContent?.trim()) return heading.textContent.trim();
  return (document.title.split(' · ')[0] ?? '').replace(/ by \S+$/, '').trim();
};

/** Reads the pull request description from its conversation page, same origin, with the reviewer's session. */
export const description = async ({ repo, number }: { repo: string; number: number }): Promise<string> => {
  try {
    const response = await fetch(`/${repo}/pull/${number}`, { credentials: 'same-origin' });
    if (!response.ok) return '';
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    const body = html.querySelector('.comment-body, [data-testid="markdown-body"]');
    const text = body?.textContent || html.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content || '';
    return text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
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

const statsByPath = new Map<string, FileStats>();
const statsOf = (diff: Element, path: string): FileStats | null => {
  const key = `${location.pathname}|${path}`;
  const cached = statsByPath.get(key);
  if (cached) return cached;
  const header = diff.querySelector('[data-diff-header-wrapper], .file-header');
  if (!header) return null;
  const stats = labelledStats(header) ?? visibleStats(header);
  statsByPath.set(key, stats);
  return stats;
};

const pathCache = new WeakMap<Element, string>();
const cachedPathOf = (element: HTMLElement) => {
  if (!pathCache.has(element)) pathCache.set(element, pathOf(element));
  return pathCache.get(element) ?? '';
};

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

const treePathOf = (item: Element) => {
  const label = labelOf(item);
  const parts = [label.match(/[^\s/]+\.[A-Za-z0-9]+/)?.[0] ?? label];
  for (let folder = item.parentElement?.closest(TREE_ITEM); folder; folder = folder.parentElement?.closest(TREE_ITEM)) {
    parts.unshift(labelOf(folder).split(/\s/)[0] ?? '');
  }
  return parts.join('/');
};

export const treeFiles = (): TreeFile[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}:not([aria-expanded])`)].map((element) => ({
    element,
    path: treePathOf(element),
  }));

export const treeFolders = (): TreeFolder[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}[aria-expanded]`)].map((element) => ({
    element,
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

export const pageCounters = (): PageCounters => {
  const connected = counters.files?.isConnected && counters.additions?.isConnected;
  if (connected || Date.now() - scannedAt < COUNTER_RESCAN_MS) return counters;
  scannedAt = Date.now();
  const [additions, deletions] = findLineCounters();
  counters = { files: findFilesCounter(), additions, deletions };
  return counters;
};

/** Whether the reviewer marked a file as viewed on GitHub, or `null` when the page doesn't say. */
export const viewed = (diff: Pick<Diff, 'element'>): boolean | null => {
  const control = [...diff.element.querySelectorAll<HTMLElement>(VIEWED)].find(
    (element) => element.matches('input') || /viewed/i.test(element.textContent ?? ''),
  );
  if (!control) return null;
  return control instanceof HTMLInputElement ? control.checked : control.getAttribute('aria-pressed') === 'true';
};

const lineOf = (diff: Pick<Diff, 'element'>, anchor: string): HTMLElement | null => {
  const exact = document.getElementById(`${diff.element.id}${anchor}`);
  if (exact) return exact;
  const cells = [...diff.element.querySelectorAll<HTMLElement>(`[data-line-number="${anchor.slice(1)}"]`)];
  return (anchor.startsWith('L') ? cells[0] : cells.at(-1)) ?? null;
};

const flash = (element: HTMLElement) => {
  const row = element.closest('tr') ?? element;
  const previous = row.style.outline;
  row.style.outline = '2px solid var(--focus-outlineColor, var(--color-accent-fg, #0969da))';
  row.style.outlineOffset = '-2px';
  setTimeout(() => {
    row.style.outline = previous;
    row.style.outlineOffset = '';
  }, FLASH_MS);
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));

/** Scrolls to a file, and to one of its lines (`R12`, `L7`) when given, briefly outlining it. */
export const reveal = async (path: string, anchor = ''): Promise<boolean> => {
  const diff = diffs().find((candidate) => candidate.path === path);
  if (!diff) return false;
  const behavior: ScrollBehavior = matchMedia('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'auto';
  diff.container.scrollIntoView({ block: 'start', behavior });
  if (!anchor) return true;
  await nextFrame();
  const line = lineOf(diff, anchor);
  if (!line) return true;
  line.scrollIntoView({ block: 'center', behavior });
  flash(line);
  return true;
};
