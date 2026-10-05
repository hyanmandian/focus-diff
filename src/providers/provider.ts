import type { FileInfo } from '@/content/files';

/**
 * What Focus Diff needs from a code review site. The bar, its numbers and its moves are the same on every site; a
 * provider says where that site keeps a review's changed files, counters, file tree and conversations. To support a
 * site, implement this in `providers/<site>/`, give it a content script in `entrypoints/`, and list it with its theme
 * in `providers/providers.ts`.
 */
export interface Provider {
  /** As listed in `providers/providers.ts`, which also has its name and its theme. */
  id: string;
  /** Match patterns for the pages the content script runs on; the bar only shows where `repository()` finds a review. */
  matches: string[];

  /** The repository whose review is open, like `owner/name` or `group/subgroup/name`, or `null` on any other page. */
  repository: () => string | null;
  /** The file diffs drawn on the page. */
  diffs: () => Diff[];
  /** Every changed file, from data the site embeds in the page, or `null` when only the drawn diffs are known. */
  summary: () => FileSummary[] | null;
  /** Whether a node the site just added is, or holds, a file diff, which is then filtered before it's painted. */
  containsDiff: (node: Node) => boolean;
  /** Attributes whose change calls for another look at the page, like a Viewed toggle's. */
  observedAttributes: string[];
  /** Whether diffs keep fixed places in a list drawn as it scrolls, where hiding one leaves a gap: they're dimmed instead. */
  isVirtualized: () => boolean;

  /** How many files the site says changed, counting those it hasn't drawn yet. */
  reportedFileCount: () => number;
  /** The site's own counters, which show the filter's numbers while one is on. */
  counters: () => PageCounters;
  /** A number the way the site writes it in its counters. */
  formatCount: (value: number) => string;

  /** The file tree beside the diffs. */
  tree: {
    files: () => TreeFile[];
    folders: () => TreeFolder[];
    /** A file's path as the tree spells it out, for trees without anchors. */
    pathOf: (element: HTMLElement) => string;
    /** The anchor of the tree link an event happened on, or `null` when it wasn't on one. */
    anchorAt: (target: EventTarget | null) => string | null;
  };

  /** The drawn diff a file anchor points to, or `null`. */
  diffAt: (anchor: string) => HTMLElement | null;
  /** The address fragment that points to a file, like `#diff-<anchor>`. */
  hashOf: (anchor: string) => string;
  /** Asks the site to draw a file it hasn't drawn yet, and to take the page to it. */
  reveal: (anchor: string) => void;
  /** How much of the top of the screen the site covers: its sticky bar, and inside a diff, the file's own header. */
  coveredTop: (inside?: Element) => number;

  /** The conversations in the files given, in page order; `complete` says the files came from the site's data. */
  conversations: (files: FileInfo[], complete: boolean) => ConversationTarget[];
}

export interface FileStats {
  additions: number;
  deletions: number;
}

/** Waiting on the reader, answered by them (they wrote or reacted to the last comment), or resolved. */
export type ThreadState = 'waiting' | 'answered' | 'resolved';

/** A file diff the site has drawn. */
export interface Diff {
  element: HTMLElement;
  path: string;
  /** What gets hidden or dimmed: the diff, or the wrapper the site lays it out in. */
  container: HTMLElement;
  /** The file's line counts, or `null` while the site hasn't shown them. */
  stats: () => FileStats | null;
  /** Whether the reader marked the file as viewed, or `null` when its toggle isn't drawn. */
  viewed: () => boolean | null;
  /** How the site points to the file, for its links and the tree; empty when it has none. */
  anchor: string;
}

/** A conversation the site's data lists, before its file is drawn. */
export interface ThreadSummary {
  id: string;
  /** The side and line it's on, like `R40` for line 40 of the new version. */
  line: string;
  state: ThreadState;
  /** What the site links to the conversation by, when it has a link for it. */
  comment: string;
}

/** A changed file in the site's data. */
export interface FileSummary {
  path: string;
  anchor: string;
  additions: number;
  deletions: number;
  viewed: boolean;
  threads: ThreadSummary[];
}

export interface TreeFile {
  element: HTMLElement;
  /** The file's anchor, when the tree links to it; empty otherwise. */
  anchor: string;
}

export interface TreeFolder {
  element: HTMLElement;
  path: string;
}

export interface PageCounters {
  files: HTMLElement | null;
  additions: HTMLElement | null;
  deletions: HTMLElement | null;
}

/** What opening a conversation can lean on, and how it knows a newer jump has taken over. */
interface OpenHelpers {
  goToFile: (file: FileInfo) => Promise<HTMLElement | null>;
  stale: () => boolean;
}

/** A conversation the bar can step to. */
export interface ConversationTarget {
  file: FileInfo;
  line: number | null;
  state: ThreadState;
  /** The conversation on the page, when it's drawn, to find the one nearest the middle of the screen. */
  element: HTMLElement | null;
  /** Brings the conversation into the page, opened, and returns what to centre and light up. */
  open: (helpers: OpenHelpers) => Promise<HTMLElement | null>;
}
