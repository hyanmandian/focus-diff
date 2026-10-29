import type { FileInfo } from "@/utils/review-files/review-files";

export interface Provider {
  id: string;
  matches: string[];

  repository: () => string | null;
  diffs: () => Diff[];
  summary: () => FileSummary[] | null;
  containsDiff: (node: Node) => boolean;
  observedAttributes: string[];
  isVirtualized: () => boolean;
  closeUp?: (hidden: { index: number; anchor: string }[], count: number) => void;

  reportedFileCount: () => number;
  counters: () => PageCounters;
  formatCount: (value: number) => string;

  tree: {
    files: () => TreeFile[];
    folders: () => TreeFolder[];
    pathOf: (element: HTMLElement) => string;
    anchorAt: (target: EventTarget | null) => string | null;
  };

  diffAt: (anchor: string) => HTMLElement | null;
  hashOf: (anchor: string) => string;
  reveal: (anchor: string) => void;
  coveredTop: (inside?: Element) => number;

  conversations: (files: FileInfo[], complete: boolean) => ConversationTarget[];
}

export interface FileStats {
  additions: number;
  deletions: number;
}

export type ThreadState = "waiting" | "answered" | "resolved";

export interface Diff {
  element: HTMLElement;
  path: string;
  container: HTMLElement;
  stats: () => FileStats | null;
  viewed: () => boolean | null;
  anchor: string;
}

export interface ThreadSummary {
  id: string;
  line: string;
  state: ThreadState;
  comment: string;
}

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

interface OpenHelpers {
  goToFile: (file: FileInfo) => Promise<HTMLElement | null>;
  stale: () => boolean;
}

export interface ConversationTarget {
  file: FileInfo;
  line: number | null;
  state: ThreadState;
  element: HTMLElement | null;
  open: (helpers: OpenHelpers) => Promise<HTMLElement | null>;
}
