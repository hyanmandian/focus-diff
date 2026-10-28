// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_ROWS } from "@/utils/github-virtual-list/github-virtual-list";

import {
  closeUp,
  collapsedThreadToggle,
  commentIndicators,
  containsDiff,
  coveredTop,
  diffAt,
  diffs,
  isVirtualized,
  openThreads,
  pageCounters,
  pullRequestData,
  reportedFileCount,
  repository,
  reveal,
  threadById,
  threadComments,
  threadRemoved,
  threads,
  treeAnchorAt,
  treeFiles,
  treeFolders,
  treePathOf,
} from "./github-page";

const embed = (data: unknown) => {
  document.head.innerHTML = "";
  const script = document.createElement("script");
  script.type = "application/json";
  script.dataset.target = "react-app.embeddedData";
  script.textContent = JSON.stringify(data);
  document.head.append(script);
};

describe("pullRequestData", () => {
  beforeEach(() => {
    history.replaceState(null, "", `/octo/web/pull/${Math.random().toString(36).slice(2)}/changes`);
  });

  it("reads files, counts, viewed state and threads and the reader's part in them wherever GitHub nests them", () => {
    embed({
      payload: {
        route: {
          diffSummaries: [
            {
              path: "a.ts",
              pathDigest: "aa",
              linesAdded: 3,
              linesDeleted: 1,
              markedAsViewed: true,
              markersMap: {
                R40: { threads: [{ id: 2 }] },
                R3: { threads: [{ id: 1 }] },
                R50: { threads: [{ id: 3 }, { id: 4 }] },
              },
            },
            { path: "b.ts", pathDigest: "bb", linesAdded: 0, linesDeleted: 9, markedAsViewed: false, markersMap: {} },
            { notAFile: true },
          ],
          markers: {
            threads: {
              1: { isResolved: true, commentsData: { comments: [{ databaseId: 10, viewerDidAuthor: false }] } },
              2: {
                isResolved: false,
                commentsData: {
                  comments: [
                    { databaseId: 20, viewerDidAuthor: true },
                    {
                      databaseId: 21,
                      viewerDidAuthor: false,
                      reactionGroups: [{ reaction: { viewerHasReacted: true } }],
                    },
                  ],
                },
              },
              3: { isResolved: false, commentsData: { comments: [{ databaseId: 30, viewerDidAuthor: false }] } },
              4: { isResolved: false },
            },
          },
        },
      },
    });
    const data = pullRequestData();
    expect(data?.files).toEqual([
      {
        path: "a.ts",
        anchor: "aa",
        additions: 3,
        deletions: 1,
        viewed: true,
        threads: [
          { id: "1", line: "R3", state: "resolved", comment: "10" },
          { id: "2", line: "R40", state: "answered", comment: "20" },
          { id: "3", line: "R50", state: "waiting", comment: "30" },
          { id: "4", line: "R50", state: "waiting", comment: "" },
        ],
      },
      { path: "b.ts", anchor: "bb", additions: 0, deletions: 9, viewed: false, threads: [] },
    ]);
  });

  it("is absent on the classic view or with unreadable data", () => {
    document.head.innerHTML = "";
    expect(pullRequestData()).toBeNull();
    embed({ unrelated: true });
    expect(pullRequestData()).toBeNull();
  });
});

describe("treePathOf", () => {
  it("keeps folder and file names with spaces whole", () => {
    document.body.innerHTML = `
      <ul role="tree">
        <li role="treeitem" aria-expanded="true"><div>my docs</div>
          <ul role="group"><li role="treeitem"><div>getting started.md</div></li></ul>
        </li>
      </ul>`;
    const [file] = treeFiles();
    expect(treePathOf(file!.element)).toBe("my docs/getting started.md");
  });
});

/** A fresh pull request address, so what the module keeps per page starts over. */
const freshPage = () => {
  history.replaceState(null, "", `/octo/web/pull/${Math.random().toString(36).slice(2, 8)}/changes`);
};

const html = (markup: string) => {
  document.body.innerHTML = markup;
};

describe("repository", () => {
  it("names the repository on a pull request's files, in either view's address", () => {
    history.replaceState(null, "", "/octo/web/pull/7/files");
    expect(repository()).toBe("octo/web");
    history.replaceState(null, "", "/octo/web/pull/7/changes/abc");
    expect(repository()).toBe("octo/web");
  });

  it("is absent anywhere else", () => {
    history.replaceState(null, "", "/octo/web/pull/7");
    expect(repository()).toBeNull();
    history.replaceState(null, "", "/octo/web/issues");
    expect(repository()).toBeNull();
  });
});

describe("containsDiff", () => {
  it("tells a file diff, or something holding one, from anything else", () => {
    html(`<div id="holder"><div role="region" id="diff-a"></div></div><p id="other"></p>`);
    expect(containsDiff(document.querySelector("#holder")!)).toBe(true);
    expect(containsDiff(document.querySelector("#diff-a")!)).toBe(true);
    expect(containsDiff(document.querySelector("#other")!)).toBe(false);
    expect(containsDiff(document.createTextNode("text"))).toBe(false);
  });
});

describe("diffs", () => {
  beforeEach(freshPage);

  it("reads each file's path wherever GitHub writes it, once per path, skipping hunks and unnamed diffs", () => {
    html(`
      <main><div><div>
        <div role="region" id="diff-one"><button data-file-path="src/a.ts">Expand</button>
          <div role="region" id="diff-one-hunk"></div></div>
      </div></div></main>
      <div data-tagsearch-path="old.ts → src/b.ts" id="diff-two"></div>
      <span id="heading-three">‎src/c.ts‎</span>
      <div role="region" id="diff-three" aria-labelledby="heading-three"></div>
      <div role="region" id="diff-four"><h3>src/d.ts</h3></div>
      <div role="region" id="diff-five"><a href="#diff-five">src/e.ts</a></div>
      <div role="region" id="diff-dup"><h3>src/d.ts</h3></div>
      <div role="region" id="diff-nameless"></div>
      <div role="region" id="diff-missing" aria-labelledby="nowhere"></div>`);
    expect(diffs().map(({ path, anchor }) => [path, anchor])).toEqual([
      ["src/a.ts", "one"],
      ["src/b.ts", "two"],
      ["src/c.ts", "three"],
      ["src/d.ts", "four"],
      ["src/e.ts", "five"],
    ]);
  });

  it("hides the wrapper GitHub lays a diff out in, up to the page layout", () => {
    html(`
      <div id="files"><div id="outer"><div id="inner"><div role="region" id="diff-a"><h3>a.ts</h3></div></div></div></div>
      <div id="shared"><div role="region" id="diff-b"><h3>b.ts</h3></div><p>sibling</p></div>
      <div id="w1"><div id="w2"><div id="w3"><div id="w4"><div id="w5">
        <div role="region" id="diff-c"><h3>c.ts</h3></div></div></div></div></div></div>`);
    const [a, b, c] = diffs();
    expect(a?.container.id).toBe("outer");
    expect(b?.container.id).toBe("diff-b");
    expect(c?.container.id).toBe("w2");
    html(`<div role="region" id="diff-d"><h3>d.ts</h3></div>`);
    expect(diffs()[0]?.container.id).toBe("diff-d");
  });

  it("keeps a node's path while it keeps its id, and reads it again when GitHub reuses the node", () => {
    html(`<div role="region" id="diff-a"><h3>a.ts</h3></div>`);
    const element = document.querySelector("#diff-a")!;
    expect(diffs()[0]?.path).toBe("a.ts");
    element.querySelector("h3")!.textContent = "renamed.ts";
    expect(diffs()[0]?.path).toBe("a.ts");
    element.id = "diff-b";
    expect(diffs()[0]?.path).toBe("renamed.ts");
  });

  it("reads line counts from a label, or the visible numbers, and keeps labelled ones while scrolling", () => {
    html(`
      <div role="region" id="diff-a"><h3>a.ts</h3><div data-diff-header-wrapper>
        <span class="sr-only">Lines changed: 1,200 additions &amp; 3 deletions</span></div></div>
      <div role="region" id="diff-b"><h3>b.ts</h3><div class="file-header">
        <span aria-label="4 additions and 5 deletions"></span></div></div>
      <div role="region" id="diff-c"><h3>c.ts</h3><div class="file-header">
        <span title="6 additions, 1 deletion"></span></div></div>
      <div role="region" id="diff-d"><h3>d.ts</h3><div class="file-header">
        <span title="">unlabelled</span><span aria-label="${"x".repeat(200)} 1 additions 1 deletions"></span>
        <span>+7</span><span>−2</span></div></div>
      <div role="region" id="diff-e"><h3>e.ts</h3><div class="file-header"><span>no numbers</span></div></div>
      <div role="region" id="diff-f"><h3>f.ts</h3></div>`);
    const stats = Object.fromEntries(diffs().map((diff) => [diff.path, diff.stats()]));
    expect(stats).toEqual({
      "a.ts": { additions: 1200, deletions: 3 },
      "b.ts": { additions: 4, deletions: 5 },
      "c.ts": { additions: 6, deletions: 1 },
      "d.ts": { additions: 7, deletions: 2 },
      "e.ts": { additions: 0, deletions: 0 },
      "f.ts": null,
    });
    const [a] = diffs();
    document.querySelector("#diff-a [data-diff-header-wrapper]")!.remove();
    expect(a?.stats()).toEqual({ additions: 1200, deletions: 3 });
    freshPage();
    expect(a?.stats()).toBeNull();
  });

  it("reads the Viewed state from the classic checkbox or the newer toggle", () => {
    html(`
      <div role="region" id="diff-a"><h3>a.ts</h3><input type="checkbox" class="js-reviewed-checkbox" checked /></div>
      <div role="region" id="diff-b"><h3>b.ts</h3><div data-diff-header-wrapper>
        <label><input type="checkbox" /> Other</label><label><input type="checkbox" checked /> Viewed</label></div></div>
      <div role="region" id="diff-c"><h3>c.ts</h3><div data-diff-header-wrapper>
        <input type="checkbox" checked /></div></div>
      <div role="region" id="diff-d"><h3>d.ts</h3>
        <button aria-pressed="false">Expand</button><button aria-pressed="true" aria-label="Not Viewed"></button></div>
      <div role="region" id="diff-e"><h3>e.ts</h3><button aria-pressed="true">Viewed</button></div>
      <div role="region" id="diff-f"><h3>f.ts</h3></div>`);
    expect(diffs().map((diff) => diff.viewed())).toEqual([true, true, null, true, true, null]);
  });
});

describe("the file tree", () => {
  it("lists files with their anchors and folders with their paths", () => {
    html(`
      <ul role="tree">
        <li role="treeitem" aria-expanded="true" aria-label="src">
          <ul role="group">
            <li role="treeitem"><div><a href="#diff-abc">a.ts</a></div></li>
            <li role="treeitem" aria-label="b.ts"></li>
            <li role="treeitem"></li>
          </ul>
        </li>
      </ul>`);
    expect(treeFiles().map((file) => file.anchor)).toEqual(["abc", "", ""]);
    expect(treeFolders().map((folder) => folder.path)).toEqual(["src"]);
    expect(treeFiles().map((file) => treePathOf(file.element))).toEqual(["src/a.ts", "src/b.ts", "src/"]);
  });

  it("names a file at the top of the tree by itself, by its row's first line", () => {
    html(`<ul role="tree"><li role="treeitem"><div>README.md
      2 comments</div></li></ul>`);
    expect(treePathOf(treeFiles()[0]!.element)).toBe("README.md");
  });

  it("names the file a click went to", () => {
    html(
      `<ul role="tree"><li role="treeitem"><a href="#diff-abc"><span>a.ts</span></a><a href="#diff-">x</a></li></ul>`,
    );
    expect(treeAnchorAt(document.querySelector("span"))).toBe("abc");
    expect(treeAnchorAt(document.querySelector('a[href="#diff-"]'))).toBeNull();
    expect(treeAnchorAt(document.querySelector("li"))).toBeNull();
    expect(treeAnchorAt(null)).toBeNull();
    expect(treeAnchorAt(window)).toBeNull();
  });
});

describe("pageCounters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    freshPage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds the classic counters by id", () => {
    html(`<span id="files_tab_counter">1,204</span>
      <div id="diffstat"><span class="color-fg-success">+5</span><span class="color-fg-danger">−1</span></div>`);
    const found = pageCounters();
    expect(found.files?.textContent).toBe("1,204");
    expect(found.additions?.textContent).toBe("+5");
    expect(found.deletions?.textContent).toBe("−1");
    expect(reportedFileCount()).toBe(1204);
  });

  it("finds the newer view's counters by their text, away from diffs and the tree", () => {
    html(`
      <ul role="tree"><li><span>+99</span></li></ul>
      <a role="tab">Files changed <span class="Counter">8</span></a>
      <div><div><span>+120</span></div><div><span>−30</span></div></div>`);
    const found = pageCounters();
    expect(found.files?.textContent).toBe("8");
    expect(found.additions?.textContent).toBe("+120");
    expect(found.deletions?.textContent).toBe("−30");
  });

  it("finds additions without deletions, and nothing on a page without counters", () => {
    html(`<a role="tab">Files changed</a><span>+3</span>`);
    expect(pageCounters()).toEqual({ files: null, additions: document.querySelector("span"), deletions: null });
    expect(reportedFileCount()).toBe(0);
    freshPage();
    html(`<p>nothing</p>`);
    expect(pageCounters()).toEqual({ files: null, additions: null, deletions: null });
  });

  it("keeps connected counters, searches again at most every two seconds, and gives up after twenty", () => {
    html(`<span id="files_tab_counter">2</span><span>+1</span>`);
    const first = pageCounters();
    expect(pageCounters()).toBe(first);

    html(`<p>gone</p>`);
    expect(pageCounters()).toBe(first);
    vi.advanceTimersByTime(2500);
    const empty = pageCounters();
    expect(empty.files).toBeNull();

    html(`<span id="files_tab_counter">3</span><span>+1</span>`);
    vi.advanceTimersByTime(30_000);
    expect(pageCounters()).toBe(empty);
  });
});

describe("the newer view's list", () => {
  it("is virtualized when rows carry an index and a digest", () => {
    html(`<div data-index="0"></div>`);
    expect(isVirtualized()).toBe(false);
    html(`<div data-index="0" data-path-digest="abc"></div>`);
    expect(isVirtualized()).toBe(true);
  });

  it("names the hidden files on the page for the list to close up around, and clears them", () => {
    const root = document.documentElement;
    closeUp([{ index: 2, anchor: "a".repeat(64) }], 8);
    expect(root.getAttribute(HIDDEN_ROWS)).toBe(`8 2:${"a".repeat(12)}`);
    const setAttribute = vi.spyOn(root, "setAttribute");
    closeUp([{ index: 2, anchor: "a".repeat(64) }], 8);
    expect(setAttribute).not.toHaveBeenCalled();
    closeUp([], 8);
    expect(root.hasAttribute(HIDDEN_ROWS)).toBe(false);
    closeUp([], 8);
    expect(root.hasAttribute(HIDDEN_ROWS)).toBe(false);
  });
});

describe("going to files", () => {
  it("finds a drawn diff by its anchor", () => {
    html(`<div id="diff-abc"></div>`);
    expect(diffAt("abc")).toBe(document.querySelector("#diff-abc"));
    expect(diffAt("def")).toBeNull();
    expect(diffAt("")).toBeNull();
  });

  it("follows the tree's link to a file, or its address without one", () => {
    html(`<ul role="tree"><li role="treeitem"><a href="#diff-abc">a.ts</a></li></ul>`);
    const clicks: string[] = [];
    document.querySelector("a")!.addEventListener("click", (event) => {
      event.preventDefault();
      clicks.push("abc");
    });
    reveal("abc");
    expect(clicks).toEqual(["abc"]);
    reveal("def");
    expect(location.hash).toBe("#diff-def");
    reveal("");
    expect(location.hash).toBe("#diff-");
  });
  it("takes GitHub to a file again when the address already points at it", () => {
    html("");
    location.hash = "diff-abc";
    let changes = 0;
    const count = () => {
      changes += 1;
    };
    addEventListener("hashchange", count);
    reveal("abc");
    removeEventListener("hashchange", count);
    expect(changes).toBe(1);
  });
});

describe("coveredTop", () => {
  it("is GitHub's sticky bar, from where file headers stick, plus the file's own header inside a file", () => {
    html(`<div role="region" id="diff-a"><div class="file-header" style="top: 64px"></div><p>line</p></div>`);
    const header = document.querySelector<HTMLElement>(".file-header")!;
    vi.spyOn(header, "offsetHeight", "get").mockReturnValue(40);
    expect(coveredTop()).toBe(64);
    expect(coveredTop(document.querySelector("p")!)).toBe(104);
    expect(coveredTop(document.body)).toBe(64);
  });

  it("falls back to a usual bar height when no header says", () => {
    html(`<p>nothing</p>`);
    expect(coveredTop()).toBe(80);
    html(`<div class="file-header" style="top: 0px"></div>`);
    expect(coveredTop()).toBe(80);
  });
});

const login = (name: string | null) => {
  document.head.innerHTML = name ? `<meta name="user-login" content="${name}" />` : "";
};

const comment = (id: number, author: string, reacted = false) =>
  `<div id="r${id}"><a data-hovercard-type="user"></a><a data-hovercard-type="user">${author}</a>${
    reacted ? `<button data-reaction-content="+1" aria-pressed="true"></button>` : ""
  }</div>`;

describe("classic threads", () => {
  it("reads each thread's state and line, skipping threads inside threads", () => {
    login("reader");
    html(`
      <div id="diff">
        <table>
          <tr><td data-line-number="4"></td><td data-line-number="5"></td></tr>
          <tr><td><review-thread-collapsible data-resolved="true">${comment(1, "ada")}</review-thread-collapsible></td></tr>
          <tr><td><review-thread-collapsible>${comment(2, "ada")}${comment(3, "reader")}
            <div class="js-resolvable-timeline-thread-container"></div></review-thread-collapsible></td></tr>
        </table>
        <div class="js-resolvable-timeline-thread-container">${comment(4, "ada", true)}<div id="rx"></div></div>
        <review-thread-collapsible>${comment(5, "ada")}</review-thread-collapsible>
        <review-thread-collapsible></review-thread-collapsible>
      </div>`);
    const found = threads(document.querySelector<HTMLElement>("#diff")!);
    expect(found.map(({ state, line }) => [state, line])).toEqual([
      ["resolved", 5],
      ["answered", null],
      ["answered", null],
      ["waiting", null],
      ["waiting", null],
    ]);
    expect(threadComments(found[2]!.element).map((each) => each.id)).toEqual(["r4"]);
  });

  it("counts every thread as waiting when the reader isn't signed in", () => {
    login(null);
    html(`<div id="diff"><review-thread-collapsible>${comment(1, "reader")}</review-thread-collapsible></div>`);
    expect(threads(document.querySelector<HTMLElement>("#diff")!)[0]?.state).toBe("waiting");
  });

  it("finds the toggle that expands a collapsed thread, but not a nested thread's", () => {
    html(`
      <review-thread-collapsible id="a"><button aria-expanded="false" data-target="review-thread-collapsible.button"></button></review-thread-collapsible>
      <review-thread-collapsible id="b"><button aria-expanded="true" data-target="review-thread-collapsible.button"></button></review-thread-collapsible>
      <review-thread-collapsible id="c"><review-thread-collapsible>
        <button aria-expanded="false" data-target="review-thread-collapsible.button"></button></review-thread-collapsible></review-thread-collapsible>`);
    const toggle = (id: string) => collapsedThreadToggle(document.querySelector<HTMLElement>(`#${id}`)!);
    expect(toggle("a")).toBe(document.querySelector("#a button"));
    expect(toggle("b")).toBeNull();
    expect(toggle("c")).toBeNull();
  });
});

describe("newer view threads", () => {
  it("reads the conversations open in a diff, on either side", () => {
    login("reader");
    html(`
      <div id="diff"><table>
        <tr><td data-line-number="12" data-diff-side="right"><div data-marker-id="7">${comment(70, "reader")}</div></td></tr>
        <tr><td data-line-number="3" data-diff-side="left"><div data-marker-id="8">${comment(80, "ada")}</div></td></tr>
        <tr><td data-line-number="9"><div data-marker-id="9"></div></td></tr>
      </table><div data-marker-id="10">${comment(100, "ada")}</div></div>`);
    expect(openThreads(document.querySelector<HTMLElement>("#diff")!)).toEqual([
      { id: "7", line: "R12", state: "answered", comment: "70" },
      { id: "8", line: "L3", state: "waiting", comment: "80" },
    ]);
    expect(threadById("8")).toBe(document.querySelector('[data-marker-id="8"]'));
    expect(threadById("11")).toBeNull();
  });

  it("tells a conversation removed from a drawn line from one whose line isn't drawn", () => {
    html(`
      <div id="diff"><table>
        <tr><td data-line-number="1" data-diff-side="right"></td></tr>
        <tr><td data-line-number="2" data-diff-side="right"><div class="CommentIndicator-module__commentIndicator_x"></div></td></tr>
        <tr><td data-line-number="3" data-diff-side="left"><div data-marker-id="1"></div></td></tr>
      </table><div data-line-number="4" data-diff-side="right"></div></div>`);
    const diff = document.querySelector<HTMLElement>("#diff")!;
    expect(threadRemoved(diff, "R1")).toBe(true);
    expect(threadRemoved(diff, "R2")).toBe(false);
    expect(threadRemoved(diff, "L3")).toBe(false);
    expect(threadRemoved(diff, "L1")).toBe(false);
    expect(threadRemoved(diff, "R4")).toBe(false);
  });

  it("lists the comment markers in a diff from top to bottom", () => {
    html(`<div id="diff">
      <div class="CommentIndicator-module__commentIndicator_x" id="low"></div>
      <div class="CommentIndicator-module__commentIndicator_x" id="high"></div></div>`);
    const at = (id: string, top: number) =>
      vi.spyOn(document.querySelector(`#${id}`)!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, 1, 1));
    at("low", 300);
    at("high", 20);
    expect(commentIndicators(document.querySelector("#diff")!).map((each) => each.id)).toEqual(["high", "low"]);
  });
});

describe("pullRequestData parsing", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("skips unreadable or unrelated data for the first script with diffs, and reads each script once", () => {
    const add = (text: string) => {
      const script = document.createElement("script");
      script.type = "application/json";
      script.dataset.target = "react-app.embeddedData";
      script.textContent = text;
      document.head.append(script);
      return script;
    };
    add("{not json");
    add(JSON.stringify({ diffSummaries: "not a list" }));
    let deep: unknown = { diffSummaries: [] };
    for (let level = 0; level < 10; level++) deep = { level: deep };
    add(JSON.stringify(deep));
    const script = add(
      JSON.stringify({
        diffSummaries: [
          { path: "a.ts", markersMap: { R1: "odd", R2: { threads: "none" }, R3: { threads: [{ id: 5 }, "odd"] } } },
          { path: 7 },
          { path: "b.ts" },
        ],
        markers: { threads: { 5: { commentsData: { comments: [] } } } },
      }),
    );
    const first = pullRequestData();
    expect(first?.files).toEqual([
      {
        path: "a.ts",
        anchor: "",
        additions: 0,
        deletions: 0,
        viewed: false,
        threads: [{ id: "5", line: "R3", state: "waiting", comment: "" }],
      },
      { path: "b.ts", anchor: "", additions: 0, deletions: 0, viewed: false, threads: [] },
    ]);
    script.textContent = "{}";
    expect(pullRequestData()).toBe(first);
  });

  it("reads every thread as waiting without details", () => {
    embed({
      diffSummaries: [{ path: "a.ts", markersMap: { R1: { threads: [{ id: 1 }] } } }],
      markers: { threads: "none" },
    });
    expect(pullRequestData()?.files[0]?.threads).toEqual([{ id: "1", line: "R1", state: "waiting", comment: "" }]);
  });

  it("reads thread states from details that are missing or odd", () => {
    embed({
      diffSummaries: [
        {
          path: "a.ts",
          markersMap: {
            Rx: { threads: [{ id: 1 }] },
            R2: { threads: [{ id: 2 }] },
            R3: { threads: [{ id: 3 }] },
            R4: { threads: [{ id: 4 }] },
          },
        },
      ],
      markers: {
        notThreads: true,
        threads: {
          2: { commentsData: { comments: [{ databaseId: 1, reactionGroups: ["odd", { reaction: "odd" }] }] } },
          3: { commentsData: { comments: [{ databaseId: 2, reactionGroups: "odd" }] } },
          4: { commentsData: "odd" },
        },
      },
    });
    expect(pullRequestData()?.files[0]?.threads.map(({ line, state }) => [line, state])).toEqual([
      ["Rx", "waiting"],
      ["R2", "waiting"],
      ["R3", "waiting"],
      ["R4", "waiting"],
    ]);
  });
});
