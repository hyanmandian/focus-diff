import type { Diff, FileStats, FileSummary, PageCounters, ThreadState, ThreadSummary, TreeFile, TreeFolder } from '@/providers/provider';

/**
 * Reads GitHub's pull request pages, in both of its diff views. The classic one draws every file and its conversations
 * up front; the newer one, shown to signed-in reviewers, draws files as they scroll into view and embeds the whole pull
 * request as data. A file's anchor is GitHub's digest of its path, as in `#diff-<digest>`.
 */

const DIFF = '[role="region"][id^="diff-"], [data-tagsearch-path][id^="diff-"]';
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
      diff.querySelector('h3, a[href^="#diff-"]')?.textContent ||
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
    byPath.set(path, {
      element,
      path,
      container: containerOf(element),
      stats: () => statsOf(element, path),
      viewed: () => viewed(element),
      anchor: element.id.startsWith('diff-') ? element.id.slice('diff-'.length) : '',
    });
  }
  return [...byPath.values()];
};

/** A tree item's name: its row's first line of text, which keeps names with spaces whole. */
const labelOf = (item: Element) =>
  (item.querySelector(':scope > div')?.textContent || item.getAttribute('aria-label') || '').trim().split('\n')[0]?.trim() ?? '';

const folderPathOf = (item: Element | null | undefined): string => {
  const parts: string[] = [];
  for (let folder = item; folder; folder = folder.parentElement?.closest(TREE_ITEM)) {
    parts.unshift(labelOf(folder));
  }
  return parts.join('/');
};

/** A file's path as the tree spells it out, for trees without `#diff-` links. */
export const treePathOf = (item: Element): string => {
  const name = labelOf(item);
  const folder = folderPathOf(item.parentElement?.closest(TREE_ITEM));
  return folder ? `${folder}/${name}` : name;
};

export const treeFiles = (): TreeFile[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}:not([aria-expanded])`)].map((element) => ({
    element,
    anchor: element.querySelector('a[href^="#diff-"]')?.getAttribute('href')?.slice('#diff-'.length) ?? '',
  }));

export const treeFolders = (): TreeFolder[] =>
  [...document.querySelectorAll<HTMLElement>(`${TREE_ITEM}[aria-expanded]`)].map((element) => ({
    element,
    path: folderPathOf(element),
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

/** The classic view's checkbox, or the newer view's toggle button, found by its label rather than its styling. */
const VIEWED = 'input.js-reviewed-checkbox, button[aria-pressed], [data-diff-header-wrapper] input[type="checkbox"]';
const VIEWED_LABEL = /^(not )?viewed$/i;

/** Whether the reviewer marked a file as viewed on GitHub, or `null` when its toggle isn't rendered. */
const viewed = (diff: Element): boolean | null => {
  for (const control of diff.querySelectorAll<HTMLElement>(VIEWED)) {
    if (control instanceof HTMLInputElement) {
      if (control.classList.contains('js-reviewed-checkbox') || VIEWED_LABEL.test(control.closest('label')?.textContent?.trim() ?? ''))
        return control.checked;
    } else if (VIEWED_LABEL.test((control.getAttribute('aria-label') ?? control.textContent ?? '').trim())) {
      return control.getAttribute('aria-pressed') === 'true';
    }
  }
  return null;
};

/** The newer diff view positions each file absolutely in a tall list and only renders the ones near the screen. */
export const isVirtualized = (): boolean => document.querySelector('[data-index][data-path-digest]') !== null;

export const diffAt = (anchor: string): HTMLElement | null => (anchor ? document.getElementById(`diff-${anchor}`) : null);

/** The file tree's link to a file, which makes GitHub scroll to it and render it. */
const treeLink = (anchor: string): HTMLAnchorElement | null =>
  anchor ? document.querySelector<HTMLAnchorElement>(`[role="treeitem"] a[href="#diff-${CSS.escape(anchor)}"]`) : null;

/** Opens a file GitHub hasn't drawn: with its folder collapsed or the tree closed, its anchor still takes GitHub there. */
export const reveal = (anchor: string): void => {
  const link = treeLink(anchor);
  if (link) link.click();
  else location.hash = `diff-${anchor}`;
};

/** The file a click in the tree went to, by the anchor of its link. */
export const treeAnchorAt = (target: EventTarget | null): string | null => {
  const link = target instanceof Element ? target.closest('[role="tree"] a[href^="#diff-"]') : null;
  return link?.getAttribute('href')?.slice('#diff-'.length) || null;
};

/** Conversation markers beside the lines of a rendered diff in the newer view, top to bottom. */
export const commentIndicators = (diff: Element): HTMLElement[] =>
  [...diff.querySelectorAll<HTMLElement>('[class*="CommentIndicator-module__commentIn"]')]
    .map((element) => ({ element, top: element.getBoundingClientRect().top }))
    .toSorted((a, b) => a.top - b.top)
    .map(({ element }) => element);

/** Review conversations in the classic view; the class is a fallback for the custom element. */
const THREAD = 'review-thread-collapsible, .js-resolvable-timeline-thread-container';

export interface Thread {
  element: HTMLElement;
  state: ThreadState;
  line: number | null;
}

const viewer = (): string | null => document.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content || null;

/** A thread's comments, each wrapped in an element with its id, like `r3727922886`. */
export const threadComments = (thread: HTMLElement): HTMLElement[] =>
  [...thread.querySelectorAll<HTMLElement>('[id^="r"]')].filter((element) => /^r\d+$/.test(element.id));

const threadState = (thread: HTMLElement, login: string | null): ThreadState => {
  if (thread.dataset.resolved === 'true') return 'resolved';
  const last = threadComments(thread).at(-1);
  if (!login || !last) return 'waiting';
  const author = [...last.querySelectorAll('a[data-hovercard-type="user"]')].find((link) => link.textContent?.trim());
  const reacted = last.querySelector('button[data-reaction-content][aria-pressed="true"]') !== null;
  return author?.textContent?.trim() === login || reacted ? 'answered' : 'waiting';
};

/** The new-version line a classic thread hangs under: the last line number on the row above it. */
const threadLine = (thread: HTMLElement): number | null => {
  const numbers = thread.closest('tr')?.previousElementSibling?.querySelectorAll('[data-line-number]');
  return Number(numbers?.[numbers.length - 1]?.getAttribute('data-line-number')) || null;
};

/**
 * Newer view: the conversations open in a diff, read from the page. GitHub's data stops at page load, so this is how a
 * conversation started or answered since then is known.
 */
export const openThreads = (diff: HTMLElement): ThreadSummary[] => {
  const login = viewer();
  return [...diff.querySelectorAll<HTMLElement>('[data-marker-id]')].flatMap((element) => {
    const [first] = threadComments(element);
    const cell = element.closest<HTMLElement>('[data-line-number]');
    if (!first || !cell) return [];
    const side = cell.dataset.diffSide === 'left' ? 'L' : 'R';
    const line = `${side}${cell.dataset.lineNumber}`;
    return [{ id: element.dataset.markerId ?? '', line, state: threadState(element, login), comment: first.id.slice(1) }];
  });
};

/**
 * Newer view: whether a conversation from GitHub's data is gone from the page, like after its comment was deleted: its
 * line is drawn, without a marker. A line that isn't drawn, say in a collapsed file, tells nothing, so it counts as there.
 */
export const threadRemoved = (diff: HTMLElement, line: string): boolean => {
  const side = line.startsWith('L') ? 'left' : 'right';
  const cell = diff.querySelector(`[data-line-number="${CSS.escape(line.slice(1))}"][data-diff-side="${side}"]`);
  const row = cell?.closest('tr');
  return Boolean(row && !row.querySelector('[class*="CommentIndicator-module__commentIn"], [data-marker-id]'));
};

/** A conversation open in the newer view, found by its thread id. */
export const threadById = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-marker-id="${CSS.escape(id)}"]`);

/** The control that expands a collapsed classic thread, like a resolved one, or `null` when it's already open. */
export const collapsedThreadToggle = (thread: HTMLElement): HTMLButtonElement | null => {
  const toggle = thread.querySelector<HTMLButtonElement>('button[aria-expanded="false"][data-target$=".button"]');
  return toggle?.closest(THREAD) === thread ? toggle : null;
};

/** Conversations inside a diff, in page order. */
export const threads = (diff: HTMLElement): Thread[] => {
  const login = viewer();
  return [...diff.querySelectorAll<HTMLElement>(THREAD)]
    .filter((element) => !element.parentElement?.closest(THREAD))
    .map((element) => ({ element, state: threadState(element, login), line: threadLine(element) }));
};

/** Used when no file header says where GitHub's sticky bar ends. */
const STICKY_FALLBACK_PX = 80;
const FILE_HEADER = '[data-diff-header-wrapper], .file-header';

/**
 * Where GitHub's sticky bar ends: each file's header sticks right below it, so its `top` says. A file brought to the
 * top lines up there, with nothing of it hidden behind the bar.
 */
const stickyBarBottom = (): number => {
  const header = document.querySelector(FILE_HEADER);
  const top = header ? Number.parseFloat(getComputedStyle(header).top) : Number.NaN;
  return Number.isFinite(top) && top > 0 ? top : STICKY_FALLBACK_PX;
};

/** How much of the screen's top GitHub covers: its bar, and over something inside a file, the file's own header too. */
export const coveredTop = (inside?: Element): number => {
  const header = inside?.closest(DIFF)?.querySelector<HTMLElement>(FILE_HEADER);
  return stickyBarBottom() + (header?.offsetHeight ?? 0);
};

/**
 * GitHub's newer diff view (shown to signed-in reviewers) embeds the whole pull request as JSON in
 * `script[data-target="react-app.embeddedData"]`: every changed file with its line counts and Viewed state, and every
 * review thread with its line. The diff list itself is virtualized, so this is the only complete picture of a large
 * pull request. The classic view has no such data; callers fall back to reading the DOM.
 */

export interface PullRequestData {
  /** A file's anchor is the SHA-256 of its path; a thread's comment is its first comment's id, which `#r<id>` opens. */
  files: FileSummary[];
}

const EMBEDDED = 'script[data-target="react-app.embeddedData"]';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

/** Finds the object that holds `key`, wherever GitHub nests it. */
const holderOf = (value: unknown, key: string, depth = 0): Json | null => {
  if (!isObject(value) || depth > 8) return null;
  if (key in value) return value;
  for (const child of Object.values(value)) {
    const found = holderOf(child, key, depth + 1);
    if (found) return found;
  }
  return null;
};

const commentsOf = (detail: unknown): Json[] =>
  isObject(detail) && isObject(detail.commentsData) && Array.isArray(detail.commentsData.comments)
    ? detail.commentsData.comments.filter(isObject)
    : [];

/** Same rule as the classic view: answered when the reader wrote or reacted to the last comment. */
const stateOf = (detail: unknown): ThreadState => {
  if (!isObject(detail)) return 'waiting';
  if (detail.isResolved === true) return 'resolved';
  const last = commentsOf(detail).at(-1);
  if (!last) return 'waiting';
  const reacted =
    Array.isArray(last.reactionGroups) &&
    last.reactionGroups.some((group) => isObject(group) && isObject(group.reaction) && group.reaction.viewerHasReacted === true);
  return last.viewerDidAuthor === true || reacted ? 'answered' : 'waiting';
};

const lineNumber = (anchor: string) => Number(anchor.slice(1)) || 0;

const parse = (text: string): PullRequestData | null => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const holder = holderOf(json, 'diffSummaries');
  if (!holder || !Array.isArray(holder.diffSummaries)) return null;
  const threadDetails = isObject(holder.markers) && isObject(holder.markers.threads) ? holder.markers.threads : {};
  const files: FileSummary[] = holder.diffSummaries.filter(isObject).flatMap((summary) => {
    if (typeof summary.path !== 'string') return [];
    const markers = isObject(summary.markersMap) ? summary.markersMap : {};
    const threads = Object.entries(markers)
      .flatMap(([line, marker]) =>
        isObject(marker) && Array.isArray(marker.threads)
          ? marker.threads.filter(isObject).map((thread) => {
              const id = String(thread.id ?? '');
              const detail = threadDetails[id];
              return { id, line, state: stateOf(detail), comment: String(commentsOf(detail)[0]?.databaseId ?? '') };
            })
          : [],
      )
      .toSorted((a, b) => lineNumber(a.line) - lineNumber(b.line));
    return [
      {
        path: summary.path,
        anchor: typeof summary.pathDigest === 'string' ? summary.pathDigest : '',
        additions: Number(summary.linesAdded) || 0,
        deletions: Number(summary.linesDeleted) || 0,
        viewed: summary.markedAsViewed === true,
        threads,
      },
    ];
  });
  return { files };
};

const parsed = new WeakMap<Element, PullRequestData | null>();

/**
 * The current pull request's embedded data, or `null` on the classic view. GitHub swaps the script element on
 * navigation, so each one is parsed once. A page can embed data for other apps too; the first with diffs wins.
 */
export const pullRequestData = (): PullRequestData | null => {
  for (const script of document.querySelectorAll(EMBEDDED)) {
    let data = parsed.get(script);
    if (data === undefined) {
      data = parse(script.textContent ?? '');
      parsed.set(script, data);
    }
    if (data) return data;
  }
  return null;
};
