/**
 * Closes up GitHub's virtual diff list around the files a filter hides. It runs in the page's own world, beside GitHub's
 * scripts, since the list's layout lives in JavaScript the bar's isolated content script can't reach.
 *
 * The newer diff view lays files out with TanStack Virtual: each row goes below the heights measured above it, plus a gap
 * after every row. A hidden file measures nothing, but its gap stays, so a run of hidden files left a blank stretch. While
 * the filter hides files, the list's gap goes to zero, each row shown carries it as padding instead, and a hidden file
 * counts as nothing, even before it's drawn.
 *
 * The content script names the hidden files on `<html>`: how many files the list has, then `index:digest` pairs, their
 * place in GitHub's list and the start of their anchor, which checks the rows on the page are the files it means.
 * Anything unexpected leaves GitHub's own layout in place.
 */

export const HIDDEN_ROWS = 'data-focus-diff-hidden-rows';
/** How much of each anchor the content script sends: enough to tell the files apart. */
export const DIGEST = 12;
const ROW = '[data-index][data-path-digest]';

interface Options {
  count: number;
  gap: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => unknown;
  [option: string]: unknown;
}

/** The parts of a TanStack Virtual instance this needs; its options are set again on every render. */
interface Virtualizer {
  options: Options;
  setOptions: (options: Options) => void;
  resizeItem: (index: number, size: number) => void;
  getVirtualItems: () => unknown;
  itemSizeCache?: Map<unknown, number>;
}

const isVirtualizer = (value: unknown): value is Virtualizer => {
  const candidate = value as Partial<Virtualizer> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.getVirtualItems === 'function' &&
    typeof candidate.resizeItem === 'function' &&
    typeof candidate.setOptions === 'function' &&
    typeof candidate.options?.gap === 'number' &&
    typeof candidate.options.estimateSize === 'function' &&
    typeof candidate.options.getItemKey === 'function'
  );
};

/** The virtualizer behind a list, from React's records on its element: the hook state of a component above it. */
const virtualizerOf = (list: Element): Virtualizer | null => {
  const key = Object.keys(list).find((name) => name.startsWith('__reactFiber$'));
  type Hook = { memoizedState?: unknown; next?: Hook | null };
  type Fiber = { memoizedState?: Hook | null; return?: Fiber | null };
  let fiber = key ? (list as unknown as Record<string, Fiber | undefined>)[key] : undefined;
  for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return ?? undefined) {
    let hook = fiber.memoizedState;
    for (let index = 0; hook && typeof hook === 'object' && index < 100; index++, hook = hook.next) {
      const state = hook.memoizedState as { current?: unknown } | null | undefined;
      for (const value of [state, state?.current]) if (isVirtualizer(value)) return value;
    }
  }
  return null;
};

interface Hidden {
  count: number;
  files: Map<number, string>;
}

const NONE: Hidden = { count: 0, files: new Map() };

const parse = (value: string | null): Hidden => {
  const [count, ...pairs] = (value ?? '').split(' ');
  const files = new Map(
    pairs.flatMap((pair) => {
      const [index, digest] = pair.split(':');
      return index && digest ? [[Number(index), digest] as const] : [];
    }),
  );
  return files.size ? { count: Number(count), files } : NONE;
};

export const closeUpList = (): void => {
  let hidden = new Map<number, string>();
  let list: Element | null = null;
  let virtualizer: Virtualizer | null = null;
  /** The options GitHub last set, before they're changed here, and its gap. */
  let latest: Options | null = null;
  let gap = 0;
  /** Sizes of files hidden before they were drawn again, to give back when they're shown. */
  const saved = new Map<number, number>();

  const closing = () => hidden.size > 0;
  const adapt = (options: Options): Options =>
    closing()
      ? { ...options, gap: 0, estimateSize: (index) => (hidden.has(index) ? 0 : options.estimateSize(index) + options.gap) }
      : options;

  const rows = () => (list ? [...list.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)] : []);
  const indexOf = (row: HTMLElement) => Number(row.dataset.index);

  /** The rows on the page are the files the content script means: each hidden one where it says, and no other there. */
  const agrees = () => {
    const digests = new Set(hidden.values());
    return rows().every((row) => {
      const digest = hidden.get(indexOf(row));
      const own = row.dataset.pathDigest ?? '';
      return digest === undefined ? !digests.has(own.slice(0, DIGEST)) : own.startsWith(digest);
    });
  };

  const pad = () => {
    for (const row of rows()) {
      const padding = closing() && !hidden.has(indexOf(row)) ? `${gap}px` : '';
      if (row.style.paddingBottom !== padding) row.style.paddingBottom = padding;
    }
  };

  const sizeOf = (index: number) => {
    const key = latest?.getItemKey(index);
    return virtualizer?.itemSizeCache?.get(key);
  };

  /**
   * Files not drawn keep the size measured when they last were: hidden ones count as nothing, and shown ones get their
   * size back, with the gap as padding while the list is closed up. Drawn ones are measured again by the list itself.
   */
  const resize = (before: Map<number, string>, wasClosing: boolean) => {
    if (!virtualizer || !latest) return;
    const drawn = new Set(rows().map(indexOf));
    for (let index = 0; index < latest.count; index++) {
      const size = sizeOf(index);
      const was = before.has(index);
      const is = hidden.has(index);
      if (is && !was && size !== undefined) saved.set(index, size - (wasClosing ? gap : 0));
      if (drawn.has(index)) continue;
      if (is && !was) virtualizer.resizeItem(index, 0);
      else if (!is && (was || wasClosing !== closing())) {
        const base = was
          ? (saved.get(index) ?? latest.estimateSize(index))
          : size === undefined
            ? undefined
            : size - (wasClosing ? gap : 0);
        if (base !== undefined) virtualizer.resizeItem(index, base + (closing() ? gap : 0));
      }
      if (!is) saved.delete(index);
    }
  };

  const patch = (target: Virtualizer) => {
    const setOptions = target.setOptions;
    latest = target.options;
    target.setOptions = (options) => {
      if (target === virtualizer) {
        latest = options;
        gap = options.gap;
      }
      setOptions(target === virtualizer ? adapt(options) : options);
    };
  };

  let wanted: Hidden = NONE;
  const update = (next: Hidden) => {
    wanted = next;
    const before = hidden;
    const wasClosing = closing();
    hidden = virtualizer && latest && next.count === latest.count ? next.files : new Map();
    if (closing() && !agrees()) hidden = new Map();
    if (!virtualizer || !latest) return;
    gap = latest.gap;
    pad();
    virtualizer.setOptions(latest);
    resize(before, wasClosing);
  };

  /** GitHub draws a new list for another pull request or commit; the hidden files apply to the one on the page. */
  const attach = () => {
    const current = document.querySelector(ROW)?.parentElement ?? null;
    if (current === list) return;
    list = current;
    const found = current ? virtualizerOf(current) : null;
    if (found !== virtualizer) {
      // The list left behind gets GitHub's own options back.
      const [previous, options] = [virtualizer, latest];
      virtualizer = found;
      if (previous && options) previous.setOptions(options);
      saved.clear();
      if (found) patch(found);
    }
    hidden = new Map();
    update(wanted);
  };

  new MutationObserver(() => {
    attach();
    // Rows drawn as the page scrolls get their padding before they're measured.
    if (closing()) {
      if (!agrees()) update(NONE);
      else pad();
    }
  }).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(() => update(parse(document.documentElement.getAttribute(HIDDEN_ROWS)))).observe(document.documentElement, {
    attributes: true,
    attributeFilter: [HIDDEN_ROWS],
  });
  attach();
  update(parse(document.documentElement.getAttribute(HIDDEN_ROWS)));
};
