import type { ThreadState } from './github';

/**
 * GitHub's newer diff view (shown to signed-in reviewers) embeds the whole pull request as JSON in
 * `script[data-target="react-app.embeddedData"]`: every changed file with its line counts and Viewed state, and every
 * review thread with its line. The diff list itself is virtualized, so this is the only complete picture of a large
 * pull request. The classic view has no such data; callers fall back to reading the DOM.
 */

interface FileSummary {
  path: string;
  /** SHA-256 of the path, as used in `#diff-<digest>` anchors and region ids. */
  digest: string;
  additions: number;
  deletions: number;
  viewed: boolean;
  /** Thread anchors in this file, like `R550` for line 550 of the new version. */
  threads: ThreadSummary[];
}

export interface ThreadSummary {
  id: string;
  line: string;
  state: ThreadState;
  /** The first comment's id; `#r<id>` is GitHub's own link that opens the thread. */
  comment: string;
}

export interface PullRequestData {
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
        digest: typeof summary.pathDigest === 'string' ? summary.pathDigest : '',
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
