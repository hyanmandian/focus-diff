import { isRecord } from "@/utils/record/record";

export const HIDDEN_ROWS = "data-focus-diff-hidden-rows";
export const DIGEST = 12;
const ROW = "[data-index][data-path-digest]";

interface Options {
  count: number;
  gap: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => unknown;
  [option: string]: unknown;
}

interface Virtualizer {
  options: Options;
  setOptions: (options: Options) => void;
  resizeItem: (index: number, size: number) => void;
  getVirtualItems: () => unknown;
  itemSizeCache?: Map<unknown, number>;
}

const isVirtualizer = (value: unknown): value is Virtualizer => {
  if (!isRecord(value) || !isRecord(value.options)) return false;
  return (
    typeof value.getVirtualItems === "function" &&
    typeof value.resizeItem === "function" &&
    typeof value.setOptions === "function" &&
    typeof value.options.gap === "number" &&
    typeof value.options.estimateSize === "function" &&
    typeof value.options.getItemKey === "function"
  );
};

const virtualizerOf = (list: Element): Virtualizer | null => {
  const key = Object.keys(list).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(list, key) : undefined;
  for (let depth = 0; isRecord(fiber) && depth < 40; depth++, fiber = fiber.return) {
    let hook = fiber.memoizedState;
    for (let index = 0; isRecord(hook) && index < 100; index++, hook = hook.next) {
      const state = hook.memoizedState;
      for (const value of [state, isRecord(state) ? state.current : undefined]) if (isVirtualizer(value)) return value;
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
  const [count, ...pairs] = (value ?? "").split(" ");
  const files = new Map(
    pairs.flatMap((pair) => {
      const [index, digest] = pair.split(":");
      return index && digest ? [[Number(index), digest] as const] : [];
    }),
  );
  return files.size > 0 ? { count: Number(count), files } : NONE;
};

const indexOf = (row: HTMLElement) => Number(row.dataset.index);

export const closeUpList = (): (() => void) => {
  let hidden = new Map<number, string>();
  let list: Element | null = null;
  let virtualizer: Virtualizer | null = null;
  let latest: Options | null = null;
  let gap = 0;
  const saved = new Map<number, number>();

  const closing = () => hidden.size > 0;
  const adapt = (options: Options): Options =>
    closing()
      ? {
          ...options,
          gap: 0,
          estimateSize: (index) => (hidden.has(index) ? 0 : options.estimateSize(index) + options.gap),
        }
      : options;

  const rows = () => [...list!.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)];

  const agrees = () => {
    const digests = new Set(hidden.values());
    return rows().every((row) => {
      const digest = hidden.get(indexOf(row));
      const own = row.dataset.pathDigest!;
      return digest === undefined ? !digests.has(own.slice(0, DIGEST)) : own.startsWith(digest);
    });
  };

  const pad = () => {
    for (const row of rows()) {
      const padding = closing() && !hidden.has(indexOf(row)) ? `${gap}px` : "";
      if (row.style.paddingBottom !== padding) row.style.paddingBottom = padding;
    }
  };

  const resize = (target: Virtualizer, options: Options, before: Map<number, string>, wasClosing: boolean) => {
    const drawn = new Set(rows().map((each) => indexOf(each)));
    for (let index = 0; index < options.count; index++) {
      const size = target.itemSizeCache?.get(options.getItemKey(index));
      const was = before.has(index);
      const is = hidden.has(index);
      if (is && !was && size !== undefined) saved.set(index, size - (wasClosing ? gap : 0));
      if (drawn.has(index)) continue;
      if (is && !was) target.resizeItem(index, 0);
      else if (!is && (was || wasClosing !== closing())) {
        const base = was
          ? (saved.get(index) ?? options.estimateSize(index))
          : size === undefined
            ? undefined
            : size - (wasClosing ? gap : 0);
        if (base !== undefined) target.resizeItem(index, base + (closing() ? gap : 0));
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
    hidden = virtualizer && latest && next.count === latest.count ? next.files : new Map<number, string>();
    if (closing() && !agrees()) hidden = new Map<number, string>();
    if (!virtualizer || !latest) return;
    gap = latest.gap;
    pad();
    virtualizer.setOptions(latest);
    resize(virtualizer, latest, before, wasClosing);
  };

  const attach = () => {
    const current = document.querySelector(ROW)?.parentElement ?? null;
    if (current === list) return;
    list = current;
    const found = current ? virtualizerOf(current) : null;
    if (found !== virtualizer) {
      const [previous, options] = [virtualizer, latest];
      virtualizer = found;
      if (previous && options) previous.setOptions(options);
      saved.clear();
      if (found) patch(found);
    }
    hidden = new Map();
    update(wanted);
  };

  const rowsObserver = new MutationObserver(() => {
    attach();
    if (closing()) {
      if (agrees()) {
        pad();
      } else {
        update(NONE);
      }
    }
  });
  rowsObserver.observe(document.body, { childList: true, subtree: true });
  const hiddenObserver = new MutationObserver(() => {
    update(parse(document.documentElement.getAttribute(HIDDEN_ROWS)));
  });
  hiddenObserver.observe(document.documentElement, { attributes: true, attributeFilter: [HIDDEN_ROWS] });
  attach();
  update(parse(document.documentElement.getAttribute(HIDDEN_ROWS)));
  return () => {
    rowsObserver.disconnect();
    hiddenObserver.disconnect();
  };
};
