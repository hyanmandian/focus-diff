// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { ContentScriptContext } from "#imports";
import { readLearned, selectionsItem } from "@/utils/bar-settings/bar-settings";
import type { Diff, FileSummary, Provider } from "@/utils/provider/provider";

import { startController, type BarProps, type BarView, type Controller } from "./review-controller";

const REPO = "octo/web";

/** What the fake site says about itself, changed by each test. */
const site = {
  repo: REPO as string | null,
  summary: null as FileSummary[] | null,
  virtualized: false,
  reported: 0,
  attributes: [] as string[],
};

const byPath = (path: string) => document.querySelector<HTMLElement>(`.diff[data-path="${path}"]`)!;
const rowOf = (path: string) => byPath(path).parentElement!;

/** Reads a drawn file the way a provider would: the diff in a row, its counts and Viewed toggle inside. */
const diffOf = (element: HTMLElement): Diff => ({
  element,
  container: element.parentElement!,
  path: element.dataset.path!,
  anchor: element.parentElement!.dataset.anchor ?? "",
  stats: () =>
    element.dataset.added === undefined
      ? null
      : { additions: Number(element.dataset.added), deletions: Number(element.dataset.deleted) },
  viewed: () => element.querySelector("input")?.checked ?? null,
});

const covered = vi.fn<Provider["coveredTop"]>(() => 0);
const reveal = vi.fn<Provider["reveal"]>();
const closeUp = vi.fn<NonNullable<Provider["closeUp"]>>();
const counter = (id: string) => document.querySelector<HTMLElement>(`#${id}`);

const provider: Provider = {
  id: "github",
  matches: [],
  repository: () => site.repo,
  diffs: () => [...document.querySelectorAll<HTMLElement>("main .diff")].map((element) => diffOf(element)),
  summary: () => site.summary,
  containsDiff: (node) => node instanceof HTMLElement && Boolean(node.querySelector(".diff")),
  get observedAttributes() {
    return site.attributes;
  },
  isVirtualized: () => site.virtualized,
  closeUp,
  reportedFileCount: () => site.reported,
  counters: () => ({ files: counter("files"), additions: counter("added"), deletions: counter("deleted") }),
  formatCount: (value) => `${value}`,
  tree: {
    files: () =>
      [...document.querySelectorAll<HTMLElement>("nav a")].map((element) => ({
        element,
        anchor: element.dataset.anchor ?? "",
      })),
    folders: () =>
      [...document.querySelectorAll<HTMLElement>("nav .folder")].map((element) => ({
        element,
        path: element.dataset.path!,
      })),
    pathOf: (element) => element.textContent,
    anchorAt: (target) =>
      target instanceof Element ? (target.closest<HTMLElement>("nav a")?.dataset.anchor ?? null) : null,
  },
  diffAt: (anchor) => document.querySelector<HTMLElement>(`[data-anchor="${anchor}"] > .diff`),
  hashOf: (anchor) => `#diff-${anchor}`,
  reveal,
  coveredTop: covered,
};

/** Draws a file: its row with the diff, and its link in the tree. */
const draw = (
  path: string,
  {
    anchor = path,
    added = 1,
    viewed = false,
  }: { anchor?: string; added?: number | null; viewed?: boolean | null } = {},
) => {
  const row = document.createElement("div");
  if (anchor) row.dataset.anchor = anchor;
  const diff = document.createElement("div");
  diff.className = "diff";
  diff.dataset.path = path;
  if (added !== null) {
    diff.dataset.added = String(added);
    diff.dataset.deleted = "1";
  }
  if (viewed !== null) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = viewed;
    diff.append(toggle);
  }
  row.append(diff);
  document.querySelector("main")!.append(row);
  const link = document.createElement("a");
  if (anchor) link.dataset.anchor = anchor;
  link.textContent = path;
  document.querySelector("nav")!.append(link);
  return row;
};

const summaryOf = (path: string, viewed = false, anchor = path): FileSummary => ({
  path,
  anchor,
  additions: 2,
  deletions: 1,
  viewed,
  threads: [],
});

const createView = () => ({
  render: vi.fn<BarView["render"]>(),
  setDark: vi.fn<BarView["setDark"]>(),
  setLocale: vi.fn<BarView["setLocale"]>(),
});

/** The setup the app keeps, as the background stores config.json. */
const setConfig = (config: unknown) => fakeBrowser.storage.local.set({ "file.config": JSON.stringify(config) });
const learned = async () => {
  const { "file.pace": text } = await fakeBrowser.storage.local.get("file.pace");
  return typeof text === "string" ? readLearned(text) : null;
};

const FILTERS = [
  { id: "code", name: "Code", include: "\\.ts$", exclude: "", repos: [] },
  { id: "docs", name: "Docs", include: "\\.md$", exclude: "", repos: [] },
  { id: "python", name: "Python", include: "\\.py$", exclude: "", repos: [] },
  { id: "elsewhere", name: "Elsewhere", include: "", exclude: "", repos: ["acme/*"] },
];

let view: ReturnType<typeof createView>;
let ctx: ContentScriptContext;
let controller: Controller;

const start = async () => {
  ctx = new ContentScriptContext("review-controller");
  controller = await startController(ctx, view, provider);
};

/** Sends the content script a message, as the background would. */
const message = async (body: unknown): Promise<void> => {
  const answers = await fakeBrowser.runtime.onMessage.trigger(body, {}, () => {});
  // The content script answers nothing, so other listeners can.
  expect(answers).toEqual([undefined]);
};

/** Watches where the page is scrolled to. */
const spyOnScroll = () => {
  const spy = vi.fn<(options: ScrollToOptions) => void>();
  vi.stubGlobal("scrollTo", spy);
  return spy;
};

/** Lets the frames, idle callbacks and storage updates waiting run. */
const settle = () => vi.advanceTimersByTimeAsync(250);

/** Places a file's row on screen. */
const box = (path: string, top: number, height = 200) => {
  rowOf(path).getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: top, width: 10, height });
};

const hidden = (path: string) => rowOf(path).style.display === "none";
const props = (): BarProps => view.render.mock.lastCall![0]!;
const lastChosen = () => props().chosen;
const renders = () => view.render.mock.calls.length;

beforeEach(async () => {
  vi.useFakeTimers();
  for (const spy of [covered, reveal, closeUp]) spy.mockClear();
  covered.mockReturnValue(0);
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 100_000 });
  history.replaceState(null, "", `/octo/web/pull/${Math.random().toString(36).slice(2)}/files`);
  Object.assign(site, {
    repo: REPO,
    summary: null,
    virtualized: false,
    reported: 0,
    attributes: [],
  });
  document.body.innerHTML = `
    <header><span id="files">3</span><span id="added">+9</span><span id="deleted">−3</span></header>
    <nav><div class="folder" data-path="src">src</div><div class="folder" data-path="docs">docs</div></nav>
    <main></main>`;
  view = createView();
  await setConfig({ filters: FILTERS });
});

afterEach(() => {
  ctx.abort();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startController", () => {
  it("wears the theme and speaks the language picked in Settings, following changes", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    await setConfig({ filters: FILTERS, theme: "light", language: "en" });
    await start();
    expect(view.setDark).toHaveBeenLastCalledWith(false);
    expect(view.setLocale).toHaveBeenLastCalledWith("en");
    await setConfig({ filters: FILTERS, theme: "system", language: "pt-BR" });
    await settle();
    expect(view.setDark).toHaveBeenLastCalledWith(true);
    expect(view.setLocale).toHaveBeenLastCalledWith("pt-BR");
    await setConfig({ filters: FILTERS, language: "en" });
    await settle();
  });

  it("stays hidden away from a review, and does nothing once its context is gone", async () => {
    site.repo = null;
    await start();
    expect(view.render).toHaveBeenCalledWith(null);
    expect(view.render).toHaveBeenCalledOnce();

    const gone = new ContentScriptContext("gone");
    gone.abort();
    await startController(gone, view, provider);
    expect(view.render).toHaveBeenCalledOnce();
  });

  it("offers the repository's filters, and filters the page as the reader picks them", async () => {
    draw("src/a.ts", { added: 4 });
    draw("src/b.ts", { viewed: true });
    draw("docs/c.md");
    await start();
    expect(props().filters.map((filter) => filter.id)).toEqual(["code", "docs", "python"]);
    expect(props().files.map((file) => [file.path, file.additions])).toEqual([
      ["src/a.ts", 4],
      ["src/b.ts", 1],
      ["docs/c.md", 1],
    ]);
    expect(lastChosen()).toEqual([]);
    expect(props().shown).toEqual(expect.objectContaining({ files: 3, viewed: 1 }));
    expect(props().isViewed(props().files[1]!)).toBe(true);

    props().onToggle("code");
    await settle();
    expect(lastChosen()).toEqual(["code"]);
    expect(await selectionsItem.getValue()).toEqual({ [REPO]: ["code"] });
    expect(props().shown).toEqual(expect.objectContaining({ files: 2, viewed: 1, additions: 5 }));
    expect([hidden("src/a.ts"), hidden("src/b.ts"), hidden("docs/c.md")]).toEqual([false, false, true]);
    // The tree shows only the filter's files, and the folders they're in.
    const tree = [...document.querySelectorAll<HTMLElement>("nav > *")].map((each) => each.style.display);
    expect(tree).toEqual(["", "none", "", "", "none"]);
    // The site's counters show the filter's numbers, through copies beside them.
    expect(counter("files")!.style.display).toBe("none");
    expect(document.querySelector("header")!.textContent).toBe("32/3+9+5−3−2");

    controller.toggle("docs");
    await settle();
    expect(lastChosen()).toEqual(["code", "docs"]);
    expect(document.querySelector("header")!.textContent).toBe("33/3+9+6−3−3");

    props().onToggle("");
    await settle();
    expect(lastChosen()).toEqual([]);
    expect(hidden("docs/c.md")).toBe(false);
    expect(document.querySelector("header")!.textContent).toBe("3+9−3");
    expect(counter("files")!.style.display).toBe("");
  });

  it("says what's next: the files left, or once they're viewed, the next filter with any", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts", { viewed: true });
    draw("docs/c.md");
    await start();
    expect(props().next).toEqual({ left: 0, nextFilter: { id: "docs", name: "Docs", left: 1 } });
    await selectionsItem.setValue({ [REPO]: [] });
    await settle();
    expect(props().next).toEqual({ left: 1, nextFilter: undefined });
  });

  it("counts no lines for a file the site hasn't shown them for, and keeps its counters", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts", { added: null });
    await start();
    expect(props().files[0]).toEqual(expect.objectContaining({ additions: 0, deletions: 0 }));
    expect(document.querySelector("header")!.textContent).toBe("31/1+9−3");
  });

  it("starts from the reader's saved filters, less those with nothing in this pull request", async () => {
    await selectionsItem.setValue({ [REPO]: ["docs", "python", "gone"] });
    draw("docs/c.md");
    draw("src/a.ts");
    await start();
    expect(lastChosen()).toEqual(["docs"]);
    await selectionsItem.setValue({ [REPO]: ["code"] });
    await settle();
    expect(lastChosen()).toEqual(["code"]);
  });

  it("keeps every filter while the site may still load files they match", async () => {
    await selectionsItem.setValue({ [REPO]: ["python"] });
    site.reported = 5;
    draw("src/a.ts");
    // A count the site doesn't show is left alone.
    counter("deleted")!.remove();
    await start();
    expect(lastChosen()).toEqual(["python"]);
    // Files not loaded yet are pending, so the counts beside the site's stay its own.
    expect(document.querySelector("header")!.textContent).toBe("30/5+9");
  });

  it("puts the page back when the reader leaves the review, and filters again on coming back", async () => {
    await selectionsItem.setValue({ [REPO]: ["docs"] });
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    expect(hidden("src/a.ts")).toBe(true);
    site.repo = null;
    history.pushState(null, "", "/octo/web");
    await vi.advanceTimersByTimeAsync(1500);
    expect(hidden("src/a.ts")).toBe(false);
    expect(closeUp).toHaveBeenLastCalledWith([], 0);
    expect(view.render).toHaveBeenLastCalledWith(null);
    expect(document.querySelectorAll("[data-focus-diff-counter]")).toHaveLength(0);
    // Again, with nothing to put back.
    closeUp.mockClear();
    document.dispatchEvent(new Event("change"));
    await settle();
    expect(closeUp).not.toHaveBeenCalled();
  });

  it("in a virtualized list, hides the file in its row and tells the list where to close up", async () => {
    site.virtualized = true;
    site.summary = [summaryOf("src/a.ts"), summaryOf("docs/c.md"), summaryOf("docs/d.md", false, "")];
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    expect(hidden("docs/c.md")).toBe(false);
    expect(byPath("docs/c.md").style.display).toBe("none");
    expect(closeUp).toHaveBeenLastCalledWith([{ index: 1, anchor: "docs/c.md" }], 3);
  });

  it("reads tree files without anchors by the path they spell out", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts", { anchor: "" });
    draw("docs/c.md", { anchor: "" });
    await start();
    const links = [...document.querySelectorAll<HTMLElement>("nav a")].map((each) => each.style.display);
    expect(links).toEqual(["", "none"]);
  });

  it("steps through the filters with files, and back to All", async () => {
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    const command = async (name: string) => {
      await message({ type: "command", command: name });
      await settle();
      return lastChosen();
    };
    expect(await command("next-filter")).toEqual(["code"]);
    expect(await command("next-filter")).toEqual(["docs"]);
    expect(await command("next-filter")).toEqual([]);
    expect(await command("previous-filter")).toEqual(["docs"]);
    expect(await command("show-all")).toEqual([]);
    await message({ type: "other" });
    await message(null);
    await settle();
    expect(lastChosen()).toEqual([]);
  });

  it("does nothing with the filters away from a review", async () => {
    draw("src/a.ts");
    await start();
    site.repo = null;
    controller.toggle("code");
    await message({ type: "command", command: "next-filter" });
    await message({ type: "command", command: "next-unviewed" });
    await settle();
    expect(await selectionsItem.getValue()).toEqual({});
  });
});

describe("picking filters", () => {
  it("goes to the first file left to review, in a transition where the browser has them", async () => {
    const transition = vi.fn<(update: () => void) => { ready: Promise<void>; finished: Promise<void> }>((update) => {
      update();
      return { ready: Promise.resolve(), finished: Promise.resolve() };
    });
    Object.assign(document, { startViewTransition: transition });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const scroll = spyOnScroll();
    draw("src/a.ts", { viewed: true });
    draw("src/b.ts");
    box("src/b.ts", 900);
    site.summary = [summaryOf("src/a.ts", true), summaryOf("src/b.ts"), summaryOf("src/later.ts")];
    await start();
    controller.toggle("code");
    await settle();
    expect(transition).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({ top: 900, behavior: "instant" });
    Reflect.deleteProperty(document, "startViewTransition");
    vi.unstubAllGlobals();
  });

  it("opens the first file left to review when the site hasn't drawn it yet", async () => {
    site.summary = [summaryOf("docs/c.md", true), summaryOf("docs/d.md")];
    draw("docs/c.md", { viewed: true });
    await start();
    controller.toggle("docs");
    await settle();
    expect(reveal).toHaveBeenCalledWith("docs/d.md");
  });

  it("gives a pick made while the last one was being prepared its own turn", async () => {
    let later = () => {};
    Object.assign(document, {
      startViewTransition: (update: () => void) => {
        later = update;
        return { ready: Promise.reject(new Error("skipped")), finished: Promise.resolve() };
      },
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    controller.toggle("code");
    await settle();
    controller.toggle("docs");
    Reflect.deleteProperty(document, "startViewTransition");
    later();
    await settle();
    expect(lastChosen()).toEqual(["code", "docs"]);
    vi.unstubAllGlobals();
  });
});

describe("next unviewed", () => {
  const next = async () => {
    await message({ type: "command", command: "next-unviewed" });
    await settle();
  };

  it("goes to the next file left to review after the one at the top, wrapping around", async () => {
    const scroll = spyOnScroll();
    draw("src/a.ts");
    draw("src/b.ts", { viewed: true });
    draw("src/c.ts");
    box("src/a.ts", -300);
    box("src/b.ts", -100);
    box("src/c.ts", 100);
    await start();
    await next();
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ top: 100 }));

    // The file at the top already brought up: on to the next one, around to the first.
    box("src/c.ts", 0);
    box("src/b.ts", -200);
    box("src/a.ts", -400);
    props().onNextFile();
    await settle();
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
  });

  it("takes the next filter with files left once the shown ones are reviewed", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts", { viewed: true });
    draw("docs/c.md");
    await start();
    await next();
    expect(lastChosen()).toEqual(["docs"]);
    // Nothing left anywhere: nothing to do.
    rowOf("docs/c.md").querySelector("input")!.checked = true;
    document.dispatchEvent(new Event("change"));
    await settle();
    await next();
    expect(lastChosen()).toEqual(["docs"]);
  });

  it("does nothing when every file is reviewed and no filter is on", async () => {
    const scroll = spyOnScroll();
    draw("src/a.ts", { viewed: true });
    await start();
    await next();
    expect(scroll).not.toHaveBeenCalled();
    expect(lastChosen()).toEqual([]);
  });

  it("opens the next file left to review when the site hasn't drawn it", async () => {
    site.summary = [summaryOf("src/a.ts"), summaryOf("src/b.ts")];
    draw("src/b.ts");
    box("src/b.ts", -300);
    await start();
    await next();
    expect(reveal).toHaveBeenLastCalledWith("src/a.ts");
    // Where the site covers nothing at all, a file it hasn't drawn sits at the top.
    covered.mockReturnValue(-10);
    reveal.mockClear();
    await next();
    expect(reveal).toHaveBeenLastCalledWith("src/a.ts");
  });
});

describe("learning the reader's pace", () => {
  const read = async (path: string, seconds: number) => {
    box(path, 0, 400);
    dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(seconds * 1000);
    dispatchEvent(new Event("scroll"));
  };
  const markViewed = async (path: string) => {
    byPath(path).querySelector("input")!.checked = true;
    document.dispatchEvent(new Event("change"));
    await settle();
  };

  it("learns from a file reviewed and marked viewed, not one ticked off or already viewed", async () => {
    draw("src/a.ts", { added: 200 });
    draw("src/b.ts");
    draw("src/c.ts", { viewed: true });
    draw("src/d.ts", { viewed: null });
    await start();
    expect(props().learned?.all.files).toBe(0);
    await read("src/a.ts", 30);
    await markViewed("src/a.ts");
    const kept = await learned();
    expect(kept?.all.files).toBe(1);
    expect(props().learned?.all.files).toBe(1);
    await markViewed("src/b.ts");
    expect(await learned()).toEqual(kept);
  });

  it("follows the pace learned elsewhere", async () => {
    draw("src/a.ts", { added: 200 });
    await start();
    const before = props().minutesOf("src/a.ts", { additions: 200, deletions: 0 });
    await fakeBrowser.storage.local.set({
      "file.pace": JSON.stringify({ all: { actual: 90, expected: 30, files: 9 }, kinds: {} }),
    });
    await settle();
    expect(props().minutesOf("src/a.ts", { additions: 200, deletions: 0 })).toBeGreaterThan(before);
  });
});

describe("watching the page", () => {
  it("filters diffs the site adds before they're painted, and other changes when it's idle", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts");
    await start();
    draw("docs/c.md");
    await vi.advanceTimersByTimeAsync(20);
    expect(hidden("docs/c.md")).toBe(true);
    const drawn = renders();
    document.querySelector("main")!.append(document.createElement("p"));
    await settle();
    expect(renders()).toBe(drawn + 1);
    // Text changes, like ticking timestamps, don't count.
    document.querySelector("p")!.textContent = "now";
    await settle();
    expect(renders()).toBe(drawn + 1);
  });

  it("watches the attributes the site's Viewed toggles change", async () => {
    site.attributes = ["data-viewed"];
    draw("src/a.ts");
    await start();
    const drawn = renders();
    byPath("src/a.ts").setAttribute("data-viewed", "");
    await vi.advanceTimersByTimeAsync(20);
    expect(renders()).toBe(drawn + 1);
  });

  it("follows GitHub's appearance", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    await start();
    expect(view.setDark).toHaveBeenLastCalledWith(false);
    document.documentElement.dataset.colorMode = "dark";
    await settle();
    expect(view.setDark).toHaveBeenLastCalledWith(true);
    delete document.documentElement.dataset.colorMode;
  });

  it("lets a reader's change overtake one the site waits on, and waits for idle time in a background tab", async () => {
    draw("src/a.ts");
    await start();
    const drawn = renders();
    document.querySelector("main")!.append(document.createElement("p"));
    await Promise.resolve();
    document.dispatchEvent(new Event("change"));
    await settle();
    expect(renders()).toBe(drawn + 1);

    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("change"));
    await settle();
    expect(renders()).toBe(drawn + 2);

    // Where the browser has idle callbacks, those (happy-dom, like Safari, has none).
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 50));
    vi.stubGlobal("cancelIdleCallback", (id: number) => {
      clearTimeout(id);
    });
    document.dispatchEvent(new Event("change"));
    await settle();
    expect(renders()).toBe(drawn + 3);
    Reflect.deleteProperty(document, "hidden");
  });
});

describe("the site's tree", () => {
  const click = (target: Element, init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const link = (path: string) => [...document.querySelectorAll("nav a")].find((each) => each.textContent === path)!;

  it("brings a drawn file in smoothly, below the sticky bar, from where the page was", async () => {
    const scroll = spyOnScroll();
    draw("src/a.ts");
    box("src/a.ts", 700);
    await start();
    expect(click(link("src/a.ts")).defaultPrevented).toBe(true);
    expect(location.hash).toBe("#diff-src/a.ts");
    await vi.advanceTimersByTimeAsync(20);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 700 }));
  });

  it("puts the page back first when the site jumped on its own, and lines up a diff it doesn't list", async () => {
    const scroll = spyOnScroll();
    draw("src/a.ts");
    await start();
    const extra = document.createElement("div");
    extra.dataset.anchor = "extra";
    extra.innerHTML = '<div class="diff"></div>';
    document.body.append(extra);
    const anchor = document.createElement("a");
    anchor.dataset.anchor = "extra";
    document.querySelector("nav")!.append(anchor);
    click(anchor);
    vi.stubGlobal("scrollY", 300);
    await vi.advanceTimersByTimeAsync(20);
    expect(scroll).toHaveBeenCalledWith({ top: 0 });
    vi.unstubAllGlobals();
  });

  it("lines up a file the site draws after the click", async () => {
    const scroll = spyOnScroll();
    await start();
    const anchor = document.createElement("a");
    anchor.dataset.anchor = "late";
    document.querySelector("nav")!.append(anchor);
    expect(click(anchor).defaultPrevented).toBe(false);
    draw("src/late.ts", { anchor: "late" });
    rowOf("src/late.ts").querySelector<HTMLElement>(".diff")!.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 400, width: 10, height: 100 });
    await vi.advanceTimersByTimeAsync(50);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 400 }));
    // Never drawn: nothing to line up.
    const lost = document.createElement("a");
    lost.dataset.anchor = "lost";
    document.querySelector("nav")!.append(lost);
    // The reader scrolling lets go of the last file.
    dispatchEvent(new Event("wheel"));
    scroll.mockClear();
    click(lost);
    await vi.advanceTimersByTimeAsync(2500);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("leaves other clicks to the site", async () => {
    draw("src/a.ts");
    await start();
    expect(click(link("src/a.ts"), { metaKey: true }).defaultPrevented).toBe(false);
    expect(click(link("src/a.ts"), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click(link("src/a.ts"), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(click(link("src/a.ts"), { altKey: true }).defaultPrevented).toBe(false);
    expect(click(link("src/a.ts"), { button: 1 }).defaultPrevented).toBe(false);
    expect(click(document.querySelector("main")!).defaultPrevented).toBe(false);
  });
});

describe("when the extension goes away", () => {
  it("puts the page back and stops listening", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    document.documentElement.setAttribute("data-focus-diff-filtering", "");
    ctx.abort();
    expect(hidden("docs/c.md")).toBe(false);
    expect(document.documentElement.hasAttribute("data-focus-diff-filtering")).toBe(false);
    const drawn = renders();
    await setConfig({ filters: [] });
    await settle();
    expect(renders()).toBe(drawn);
  });

  it("keeps no picks made after it's gone", async () => {
    draw("src/a.ts");
    await start();
    ctx.abort();
    controller.toggle("code");
    expect(await selectionsItem.getValue()).toEqual({});
  });

  it("still puts the page back once the extension itself is gone", async () => {
    await selectionsItem.setValue({ [REPO]: ["code"] });
    draw("src/a.ts");
    draw("docs/c.md");
    await start();
    expect(hidden("docs/c.md")).toBe(true);
    const id = fakeBrowser.runtime.id;
    Object.assign(fakeBrowser.runtime, { id: undefined });
    expect(ctx.isInvalid).toBe(true);
    Object.assign(fakeBrowser.runtime, { id });
    expect(hidden("docs/c.md")).toBe(false);
  });
});
