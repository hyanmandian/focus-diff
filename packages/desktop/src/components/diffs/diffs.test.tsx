import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useImperativeHandle, useLayoutEffect, type ReactNode, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Diffs, type DiffsHandle } from "@/components/diffs/diffs";
import type { Exchange, Finding } from "@/utils/ai/ai";
import type { AiAnswer } from "@/utils/bridge/bridge";
import { BinaryFile, bothVersions, type Source } from "@/utils/contents/contents";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Draft, ReviewFile, Thread } from "@/utils/review/review";

type Hovered = { lineNumber: number; side?: "additions" | "deletions" };
type Annotation = { side?: "additions" | "deletions"; lineNumber: number; metadata: { kind: string } };
type Item = {
  id: string;
  type: "diff" | "file";
  annotations?: Annotation[];
  collapsed?: boolean;
  version?: number;
  fileDiff?: FileDiffMetadata;
  file?: { name: string; contents: string };
};
type Options = {
  diffStyle: string;
  overflow: string;
  themeType: string;
  enableGutterUtility: boolean;
  enableLineSelection: boolean;
  onLineSelectionEnd: (range: SelectedLineRange | null, latest?: { item?: { id: string } }) => void;
  onLineEnter: (line: { lineNumber: number; annotationSide?: "additions" | "deletions" }, context?: object) => void;
  onLineLeave: () => void;
  onPostRender: (node: HTMLElement) => void;
  loadDiffFiles?: (diff: { name: string; type: string }) => Promise<{
    oldFile: { name: string; contents: string } | null;
    newFile: { name: string; contents: string; cacheKey: string };
  }>;
};
type Rendered = { id: string; element: HTMLElement };
type Instance = { getContainerElement: () => HTMLElement | undefined; getRenderedItems: () => Rendered[] };
type Handle = { scrollTo: (target: object) => void; getInstance: () => Instance | undefined };
type ViewProps = {
  ref?: Ref<Handle>;
  items: Item[];
  options: Options;
  renderGutterUtility: (getHovered: () => Hovered | undefined, item: Item) => ReactNode;
  renderHeaderMetadata: (item: Item) => ReactNode;
  renderAnnotation: (annotation: Annotation, diff: unknown, item: Item) => ReactNode;
  renderCodeViewFooter: () => ReactNode;
};

const lib = vi.hoisted(() => ({
  props: null as Omit<ViewProps, "ref"> | null,
  scrolled: [] as object[],
  hovered: undefined as Hovered | undefined,
  instance: undefined as Instance | undefined,
}));

function FakeCodeView({ ref, ...view }: ViewProps) {
  useLayoutEffect(() => {
    lib.props = view;
  });
  useImperativeHandle(ref, () => ({
    scrollTo: (target) => {
      lib.scrolled.push(target);
    },
    getInstance: () => lib.instance,
  }));
  return (
    <div data-testid="code-view">
      {view.items.map((entry) => (
        <section key={entry.id} aria-label={entry.id} data-collapsed={String(entry.collapsed)} data-type={entry.type}>
          <div>{view.renderHeaderMetadata(entry)}</div>
          {view.renderGutterUtility(() => lib.hovered, entry)}
          {entry.annotations?.map((a) => (
            <div key={`${a.metadata.kind}:${a.side}:${a.lineNumber}`} data-at={`${a.side}:${a.lineNumber}`}>
              {view.renderAnnotation(a, entry.fileDiff, entry)}
            </div>
          ))}
        </section>
      ))}
      <footer>{view.renderCodeViewFooter()}</footer>
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => ({
  CodeView: (given: ViewProps) => FakeCodeView(given),
}));

vi.mock("@/components/thread/thread", () => ({
  ThreadView: ({
    thread,
    moved,
    onReply,
    onResolve,
  }: {
    thread: Thread;
    moved: boolean;
    onReply: (body: string) => Promise<void>;
    onResolve: (resolved: boolean) => Promise<void>;
  }) => (
    <div>
      <p>
        Conversation {thread.id}
        {moved ? " (moved)" : ""}
      </p>
      <button type="button" onClick={() => void onReply("Agreed")}>
        Reply to {thread.id}
      </button>
      <button type="button" onClick={() => void onResolve(true)}>
        Resolve {thread.id}
      </button>
    </div>
  ),
  DraftView: ({ draft, onEdit, onRemove }: { draft: Draft; onEdit: (body: string) => void; onRemove: () => void }) => (
    <div>
      <p>Pending {draft.body}</p>
      <button
        type="button"
        onClick={() => {
          onEdit("Edited");
        }}
      >
        Edit {draft.key}
      </button>
      <button type="button" onClick={onRemove}>
        Remove {draft.key}
      </button>
    </div>
  ),
  FindingView: ({
    finding,
    by,
    onAdd,
    onDismiss,
  }: {
    finding: Finding;
    by: string;
    onAdd: () => void;
    onDismiss: () => void;
  }) => (
    <div>
      <p>
        {by}: {finding.body}
      </p>
      <button type="button" onClick={onAdd}>
        Add finding
      </button>
      <button type="button" onClick={onDismiss}>
        Dismiss finding
      </button>
    </div>
  ),
  NewComment: ({
    lines,
    path,
    file,
    onAdd,
    onSendNow,
    onCancel,
    ask,
  }: {
    lines: string;
    path: string;
    file?: boolean;
    onAdd: (body: string) => void;
    onSendNow: (body: string) => Promise<void>;
    onCancel: () => void;
    ask: ((question: string, earlier: Exchange[], run: string) => Promise<AiAnswer>) | null;
  }) => (
    <div>
      <p>
        New comment on {lines} of {path}
        {file ? " (file)" : ""}
      </p>
      <textarea aria-label="New comment" />
      <button
        type="button"
        onClick={() => {
          onAdd("Rename it");
        }}
      >
        Add comment
      </button>
      <button type="button" onClick={() => void onSendNow("Rename it")}>
        Post comment
      </button>
      <button type="button" onClick={onCancel}>
        Cancel comment
      </button>
      {ask ? (
        <button type="button" onClick={() => void ask("Why?", [], "run-1")}>
          Ask about it
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/rendered/rendered", async (original) => ({
  ...(await original<object>()),
  Rendered: ({ file }: { file: ReviewFile }) => <p>Rendered {file.path}</p>,
}));

vi.mock("@/components/rich-diff/rich-diff", () => ({
  NoPatchFile: ({
    file,
    viewed,
    loading,
    error,
    onViewed,
    onLoad,
  }: {
    file: ReviewFile;
    viewed: boolean;
    loading: boolean;
    error: string | null;
    onViewed: (viewed: boolean) => void;
    onLoad?: () => void;
  }) => (
    <div id={`file-${file.path}`}>
      <p>
        No patch for {file.path}
        {viewed ? " · viewed" : ""}
        {loading ? " · loading" : ""}
        {error ? ` · ${error}` : ""}
      </p>
      {onLoad ? (
        <button type="button" onClick={onLoad}>
          Load {file.path}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          onViewed(true);
        }}
      >
        Mark {file.path} viewed
      </button>
    </div>
  ),
}));

vi.mock("@/utils/contents/contents", async (original) => ({
  ...(await original<object>()),
  bothVersions: vi.fn<typeof bothVersions>(),
}));

const patchOf = (path: string, hunks: string, status = "modified", old = path) =>
  [
    `diff --git a/${old} b/${path}`,
    ...(old === path ? [] : [`rename from ${old}`, `rename to ${path}`]),
    status === "added" ? "--- /dev/null" : `--- a/${old}`,
    status === "removed" ? "+++ /dev/null" : `+++ b/${path}`,
    hunks,
    "",
  ].join("\n");

const CART: ReviewFile = {
  path: "src/cart.ts",
  previousPath: null,
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: patchOf(
    "src/cart.ts",
    "@@ -1,3 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;\n export {};",
  ),
};
const README: ReviewFile = {
  path: "README.md",
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: patchOf("README.md", "@@ -1,1 +1,2 @@\n # App\n+More"),
};
const OLD: ReviewFile = {
  path: "src/old.ts",
  previousPath: null,
  status: "removed",
  additions: 0,
  deletions: 2,
  patch: patchOf("src/old.ts", "@@ -1,2 +0,0 @@\n-gone\n-too", "removed"),
};
const MOVED: ReviewFile = {
  path: "src/new-name.ts",
  previousPath: "src/old-name.ts",
  status: "renamed",
  additions: 1,
  deletions: 1,
  patch: patchOf("src/new-name.ts", "@@ -1,1 +1,1 @@\n-x\n+y", "renamed", "src/old-name.ts"),
};
const BIG: ReviewFile = {
  path: "data/big.json",
  previousPath: null,
  status: "modified",
  additions: 5000,
  deletions: 10,
  patch: "",
};
const LOGO: ReviewFile = { ...BIG, path: "logo.png", previousPath: "old-logo.png", status: "renamed" };

const SOURCE: Source = { repo: "acme/app", head: "head1", base: () => Promise.resolve("base1") };
const LINK = { owner: "acme", repo: "app", number: 12, head: "head1" };

const thread = (more: Partial<Thread> = {}): Thread => ({
  id: "t1",
  path: CART.path,
  side: "additions",
  line: 2,
  resolved: false,
  outdated: false,
  comments: [
    {
      id: "c1",
      databaseId: 1,
      author: { login: "ana" },
      html: "<p>Hm</p>",
      at: "2026-10-01T00:00:00Z",
      url: "https://github.com/acme/app/pull/12#discussion_r1",
    },
  ],
  ...more,
});

type Props = Parameters<typeof Diffs>[0];

function props(more: Partial<Props> = {}) {
  return {
    files: [CART],
    threads: new Map<string, Thread[]>(),
    drafts: [] as Draft[],
    findings: [] as Finding[],
    findingsBy: "Claude",
    onAcceptFinding: vi.fn<Props["onAcceptFinding"]>(),
    pull: "acme/octo#1",
    onAsk: null,
    onDismissFinding: vi.fn<Props["onDismissFinding"]>(),
    isViewed: () => false,
    opened: new Set<string>(),
    diffStyle: "split" as const,
    wrap: false,
    whitespace: false,
    dark: false,
    source: SOURCE,
    commentable: true,
    link: LINK,
    onSay: vi.fn<Props["onSay"]>(),
    onViewed: vi.fn<Props["onViewed"]>(),
    onAddDraft: vi.fn<Props["onAddDraft"]>(),
    onEditDraft: vi.fn<Props["onEditDraft"]>(),
    onRemoveDraft: vi.fn<Props["onRemoveDraft"]>(),
    onCommentNow: vi.fn<Props["onCommentNow"]>(() => Promise.resolve()),
    onReply: vi.fn<Props["onReply"]>(() => Promise.resolve()),
    onResolve: vi.fn<Props["onResolve"]>(() => Promise.resolve()),
    ...more,
  } satisfies Props;
}

function draw(more: Partial<Props> = {}) {
  const ref = createRef<DiffsHandle>();
  const p = props(more);
  const result = render(<Diffs ref={ref} {...p} />);
  const redraw = (next: Partial<Props>) => {
    result.rerender(<Diffs ref={ref} {...p} {...next} />);
  };
  return { ...result, ref, p, redraw };
}

const options = () => lib.props!.options;
const item = (path: string) => lib.props!.items.find((i) => i.id === path);
const file = (path: string) => screen.getByRole("region", { name: path });
const pick = (path: string, range: SelectedLineRange) => {
  act(() => {
    options().onLineSelectionEnd(range, { item: { id: path } });
  });
};
const over = (path: string, lineNumber: number, side: "additions" | "deletions" = "additions") => {
  act(() => {
    options().onLineEnter({ lineNumber, annotationSide: side }, { item: { id: path } });
  });
};
const rect = (top: number, height: number) => new DOMRect(0, top, 100, height);
const withRect = (box: DOMRect) => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => box;
  return el;
};

const nothing = () => {};

function deferred<T>() {
  let resolve: (value: T) => void = nothing;
  let reject: (reason: unknown) => void = nothing;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function rust(confirmed = true) {
  const sent: Array<[string, unknown]> = [];
  mockCommands((cmd, args) => {
    sent.push([cmd, args]);
    return cmd === "confirm" ? confirmed : null;
  });
  return sent;
}

let clipboard: string[] = [];
function clipboardWorks(works = true) {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (!works) return Promise.reject(new Error("denied"));
        clipboard.push(text);
        return Promise.resolve();
      },
    },
  });
}

function setup(works = true) {
  const user = userEvent.setup();
  clipboardWorks(works);
  return user;
}

beforeEach(() => {
  lib.props = null;
  lib.scrolled = [];
  lib.hovered = undefined;
  lib.instance = undefined;
  vi.mocked(bothVersions).mockReset();
  rust();
  clipboardWorks();
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("Diffs", () => {
  describe("the list", () => {
    it("lists the files with a diff, folding the viewed ones unless opened", () => {
      const { redraw } = draw({
        files: [CART, README, BIG],
        isViewed: (f) => f.path === README.path,
      });
      expect(lib.props!.items.map((i) => i.id)).toEqual([CART.path, README.path]);
      expect(file(README.path).dataset.collapsed).toBe("true");
      expect(file(CART.path).dataset.collapsed).toBe("false");
      redraw({ files: [CART, README, BIG], isViewed: (f) => f.path === README.path, opened: new Set([README.path]) });
      expect(file(README.path).dataset.collapsed).toBe("false");
    });

    it("gives the library its options: layout, wrapping, theme, commenting", () => {
      const { redraw } = draw();
      expect(options()).toMatchObject({
        diffStyle: "split",
        overflow: "scroll",
        themeType: "light",
        enableGutterUtility: true,
        enableLineSelection: true,
      });
      expect(
        screen
          .getByTestId("code-view")
          .parentElement?.parentElement?.style.getPropertyValue("--diffs-bg-addition-override"),
      ).toBe("#f3fcf5");
      redraw({ diffStyle: "unified", wrap: true, dark: true, commentable: false, source: null });
      expect(options()).toMatchObject({
        diffStyle: "unified",
        overflow: "wrap",
        themeType: "dark",
        enableGutterUtility: false,
        enableLineSelection: false,
      });
      expect(options().loadDiffFiles).toBeUndefined();
    });

    it("keeps each file's item while nothing it shows changed, and builds it again when something did", () => {
      const { redraw, p } = draw();
      const first = item(CART.path);
      redraw({ threads: new Map(p.threads) });
      expect(item(CART.path)).toBe(first);
      redraw({ files: [{ ...CART, patch: CART.patch.replace("const c = 4", "const c = 5") }] });
      expect(item(CART.path)).not.toBe(first);
      expect(item(CART.path)?.version).toBe(first?.version);
      redraw({ whitespace: true });
      const hidden = item(CART.path);
      expect(hidden?.version).not.toBe(first?.version);
      redraw({ whitespace: true, threads: new Map() });
      expect(item(CART.path)?.fileDiff).toBe(hidden?.fileDiff);
    });

    it("puts conversations, pending comments, the AI's comments and the new comment between the lines", async () => {
      const user = setup();
      const onLine = thread();
      const gone = thread({ id: "t2", line: 40 });
      const drafts: Draft[] = [
        { key: "d1", path: CART.path, side: "additions", line: 3, body: "Keep it" },
        { key: "d2", path: CART.path, side: "additions", line: 0, body: "On the file", file: true },
      ];
      const findings: Finding[] = [
        { path: CART.path, line: 3, severity: "issue", body: "Off by one", inDiff: true },
        { path: OLD.path, line: 2, severity: "question", body: "Why gone?", inDiff: true },
        { path: CART.path, line: 90, severity: "suggestion", body: "Elsewhere", inDiff: false },
      ];
      const { p } = draw({
        files: [CART, OLD],
        threads: new Map([[CART.path, [onLine, gone]]]),
        drafts,
        findings,
      });
      const at = (path: string, where: string) =>
        file(path).querySelector<HTMLElement>(`[data-at="${where}"]`)?.textContent ?? "";
      expect(at(CART.path, "additions:2")).toContain("Conversation t1");
      expect(at(CART.path, "additions:0")).toContain("Conversation t2 (moved)");
      expect(at(CART.path, "additions:3")).toContain("Pending Keep it");
      expect(within(file(CART.path)).getByText("Pending On the file")).toBeTruthy();
      expect(within(file(CART.path)).getByText("Claude: Off by one")).toBeTruthy();
      expect(at(OLD.path, "deletions:2")).toContain("Claude: Why gone?");
      expect(screen.queryByText(/Elsewhere/u)).toBeNull();

      await user.click(screen.getByRole("button", { name: "Reply to t1" }));
      expect(p.onReply).toHaveBeenCalledWith(onLine, "Agreed");
      await user.click(screen.getByRole("button", { name: "Resolve t1" }));
      expect(p.onResolve).toHaveBeenCalledWith(onLine, true);
      await user.click(screen.getByRole("button", { name: "Edit d1" }));
      expect(p.onEditDraft).toHaveBeenCalledWith("d1", "Edited");
      await user.click(within(file(OLD.path)).getByRole("button", { name: "Add finding" }));
      expect(p.onAcceptFinding).toHaveBeenCalledWith(findings[1], "deletions");
      await user.click(within(file(CART.path)).getByRole("button", { name: "Dismiss finding" }));
      expect(p.onDismissFinding).toHaveBeenCalledWith(findings[0]);
    });

    it("removes a pending comment once the native alert says so", async () => {
      const user = setup();
      const drafts: Draft[] = [{ key: "d1", path: CART.path, side: "additions", line: 3, body: "Keep it" }];
      const sent = rust(false);
      const { p } = draw({ drafts });
      await user.click(screen.getByRole("button", { name: "Remove d1" }));
      await waitFor(() => {
        expect(sent.some(([cmd]) => cmd === "confirm")).toBe(true);
      });
      expect(p.onRemoveDraft).not.toHaveBeenCalled();
      rust(true);
      await user.click(screen.getByRole("button", { name: "Remove d1" }));
      await waitFor(() => {
        expect(p.onRemoveDraft).toHaveBeenCalledWith("d1");
      });
    });
  });

  describe("commenting", () => {
    it("opens the box on lines picked by dragging, and adds the comment to the review", async () => {
      const user = setup();
      const { p } = draw();
      act(() => {
        options().onLineSelectionEnd(null, { item: { id: CART.path } });
        options().onLineSelectionEnd({ start: 2, end: 3, side: "additions", endSide: "additions" });
      });
      expect(screen.queryByText(/New comment/u)).toBeNull();
      pick(CART.path, { start: 3, end: 2, side: "additions", endSide: "additions" });
      expect(screen.getByText("New comment on lines 2–3 of src/cart.ts")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Add comment" }));
      expect(p.onAddDraft).toHaveBeenCalledWith({
        path: CART.path,
        side: "additions",
        line: 3,
        startSide: "additions",
        startLine: 2,
        body: "Rename it",
      });
      expect(screen.queryByText(/New comment/u)).toBeNull();
    });

    it("posts a comment on one line now, and closes", async () => {
      const user = setup();
      const { p } = draw();
      pick(CART.path, { start: 2, end: 2, side: "deletions", endSide: "deletions" });
      expect(screen.getByText("New comment on line 2 of src/cart.ts")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Post comment" }));
      expect(p.onCommentNow).toHaveBeenCalledWith({ path: CART.path, side: "deletions", line: 2, body: "Rename it" });
      await waitFor(() => {
        expect(screen.queryByText(/New comment/u)).toBeNull();
      });
      pick(CART.path, { start: 2, end: 2 });
      await user.click(screen.getByRole("button", { name: "Cancel comment" }));
      expect(screen.queryByText(/New comment/u)).toBeNull();
    });

    it("comments on a line from the + beside it", async () => {
      const user = setup();
      draw();
      const plus = screen.getByRole("button", { name: "Comment on this line" });
      await user.click(plus);
      expect(screen.queryByText(/New comment/u)).toBeNull();
      lib.hovered = { lineNumber: 1, side: "deletions" };
      await user.click(plus);
      expect(screen.getByText("New comment on line 1 of src/cart.ts")).toBeTruthy();
      expect(file(CART.path).querySelector('[data-at="deletions:1"]')).toBeTruthy();
      lib.hovered = { lineNumber: 4 };
      await user.click(plus);
      expect(file(CART.path).querySelector('[data-at="additions:4"]')).toBeTruthy();
    });

    it("comments on a file as a whole from its header", async () => {
      const user = setup();
      const { p } = draw();
      await user.click(screen.getByRole("button", { name: "Comment on src/cart.ts" }));
      expect(screen.getByText("New comment on the file of src/cart.ts (file)")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Add comment" }));
      expect(p.onAddDraft).toHaveBeenCalledWith({
        path: CART.path,
        side: "additions",
        line: 0,
        body: "Rename it",
        file: true,
      });
      await user.click(screen.getByRole("button", { name: "Comment on src/cart.ts" }));
      await user.click(screen.getByRole("button", { name: "Post comment" }));
      expect(p.onCommentNow).toHaveBeenCalledWith({
        path: CART.path,
        side: "additions",
        line: 0,
        body: "Rename it",
        file: true,
      });
    });

    it("asks the AI about the lines picked, when there's one", async () => {
      const user = setup();
      const onAsk = vi.fn<NonNullable<Props["onAsk"]>>(() => Promise.resolve({ text: "", project: false }));
      const { redraw } = draw();
      pick(CART.path, { start: 2, end: 2 });
      expect(screen.queryByRole("button", { name: "Ask about it" })).toBeNull();
      redraw({ onAsk });
      await user.click(screen.getByRole("button", { name: "Ask about it" }));
      expect(onAsk).toHaveBeenCalledWith(CART.path, { start: 2, end: 2 }, "Why?", [], "run-1");
    });
  });

  describe("a file's header", () => {
    it("marks a file viewed", async () => {
      const user = setup();
      const { p } = draw();
      await user.click(screen.getByRole("checkbox", { name: "Viewed src/cart.ts" }));
      expect(p.onViewed).toHaveBeenCalledWith(CART, true);
    });

    it("shows Markdown rendered and back to its source", async () => {
      const user = setup();
      const { redraw } = draw({ files: [CART, README] });
      expect(within(file(CART.path)).queryByRole("button", { name: "Show Rendered" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Show Rendered" }));
      expect(file(README.path).dataset.type).toBe("file");
      expect(screen.getByText("Rendered README.md")).toBeTruthy();
      const shown = item(README.path);
      redraw({ files: [CART, README], threads: new Map() });
      expect(item(README.path)).toBe(shown);
      redraw({ files: [CART, README], source: null });
      expect(screen.queryByText("Rendered README.md")).toBeNull();
      redraw({ files: [CART, README] });
      await user.click(screen.getByRole("button", { name: "Show Source" }));
      expect(file(README.path).dataset.type).toBe("diff");
    });

    it("draws no controls for a file it isn't given", () => {
      draw();
      expect(lib.props!.renderHeaderMetadata({ id: "gone.ts", type: "diff" })).toBeNull();
    });

    it("copies the path, a permalink and a link to the diff, and opens the file on GitHub", async () => {
      const user = setup();
      const sent = rust();
      const { p } = draw({ files: [CART, OLD, MOVED] });
      const menu = async (path: string, entry: string) => {
        await user.click(screen.getByRole("button", { name: `Actions for ${path}` }));
        await user.click(screen.getByRole("menuitem", { name: entry }));
      };
      await menu(CART.path, "Copy Path");
      expect(clipboard.at(-1)).toBe("src/cart.ts");
      expect(p.onSay).toHaveBeenLastCalledWith("Path copied");
      await menu(CART.path, "Copy Permalink");
      await waitFor(() => {
        expect(clipboard.at(-1)).toBe("https://github.com/acme/app/blob/head1/src/cart.ts");
      });
      expect(p.onSay).toHaveBeenLastCalledWith("Link copied");
      await menu(OLD.path, "Copy Permalink");
      await waitFor(() => {
        expect(clipboard.at(-1)).toBe("https://github.com/acme/app/blob/base1/src/old.ts");
      });
      await menu(CART.path, "Copy Link to Diff");
      await waitFor(() => {
        expect(clipboard.at(-1)).toMatch(/^https:\/\/github\.com\/acme\/app\/pull\/12\/files#diff-[0-9a-f]{64}$/u);
      });
      await menu(MOVED.path, "Open File on GitHub");
      expect(sent).toContainEqual(["open_url", { url: "https://github.com/acme/app/blob/head1/src/new-name.ts" }]);
      await user.click(screen.getByRole("button", { name: `Actions for ${OLD.path}` }));
      expect(screen.getByRole("menuitem", { name: "Open File on GitHub" }).getAttribute("aria-disabled")).toBe("true");
    });

    it("links an older range's lines at the commit they're from", async () => {
      const user = setup();
      draw({ files: [CART], source: { ...SOURCE, head: "range2" } });
      await user.click(screen.getByRole("button", { name: `Actions for ${CART.path}` }));
      await user.click(screen.getByRole("menuitem", { name: "Copy Permalink" }));
      await waitFor(() => {
        expect(clipboard.at(-1)).toBe("https://github.com/acme/app/blob/range2/src/cart.ts");
      });
    });

    it("says when the clipboard or the merge base can't be had", async () => {
      const user = setup(false);
      const { p, redraw } = draw({ files: [OLD] });
      const menu = async (entry: string) => {
        await user.click(screen.getByRole("button", { name: `Actions for ${OLD.path}` }));
        await user.click(screen.getByRole("menuitem", { name: entry }));
      };
      await menu("Copy Path");
      await waitFor(() => {
        expect(p.onSay).toHaveBeenLastCalledWith("Couldn't reach the clipboard");
      });
      redraw({ files: [OLD], source: { ...SOURCE, base: () => Promise.reject(new Error("No merge base")) } });
      await menu("Copy Permalink");
      await waitFor(() => {
        expect(p.onSay).toHaveBeenLastCalledWith("No merge base");
      });
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the bridge rejects with GitHub's words, not an Error
      redraw({ files: [OLD], source: { ...SOURCE, base: () => Promise.reject("offline") } });
      await menu("Copy Permalink");
      await waitFor(() => {
        expect(p.onSay).toHaveBeenLastCalledWith("offline");
      });
    });

    it("offers no links before the pull request's head is known", async () => {
      const user = setup();
      draw({ link: null, source: null });
      await user.click(screen.getByRole("button", { name: `Actions for ${CART.path}` }));
      for (const entry of ["Copy Permalink", "Copy Link to Diff", "Open File on GitHub"])
        expect(screen.getByRole("menuitem", { name: entry }).getAttribute("aria-disabled")).toBe("true");
    });
  });

  describe("the code's contextual menu", () => {
    const rightClick = (target: Element = screen.getByTestId("code-view")) => {
      fireEvent.contextMenu(target);
    };

    it("is the system's away from a line, in a text field, or over selected text", () => {
      draw();
      rightClick();
      expect(screen.queryByRole("menu")).toBeNull();
      over(CART.path, 2);
      lib.hovered = { lineNumber: 2 };
      act(() => {
        options().onLineSelectionEnd({ start: 2, end: 2 }, { item: { id: CART.path } });
      });
      rightClick(screen.getByRole("textbox", { name: "New comment" }));
      expect(screen.queryByRole("menu")).toBeNull();
      const words = document.createRange();
      words.selectNodeContents(screen.getByText(/New comment on/u));
      window.getSelection()!.addRange(words);
      rightClick();
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("comments on the line under the pointer, and copies links to it", async () => {
      const user = setup();
      const { p } = draw({ files: [CART, OLD] });
      over(CART.path, 3);
      rightClick(within(file(CART.path)).getByRole("button", { name: "Comment on this line" }));
      const menu = await screen.findByRole("menu");
      await user.click(within(menu).getByRole("menuitem", { name: "Comment…" }));
      expect(screen.getByText("New comment on line 3 of src/cart.ts")).toBeTruthy();

      over(OLD.path, 1, "deletions");
      rightClick();
      await user.click(await screen.findByRole("menuitem", { name: "Copy Permalink" }));
      await waitFor(() => {
        expect(clipboard.at(-1)).toBe("https://github.com/acme/app/blob/base1/src/old.ts#L1");
      });
      rightClick();
      await user.click(await screen.findByRole("menuitem", { name: "Copy Link to Diff" }));
      await waitFor(() => {
        expect(clipboard.at(-1)).toMatch(/#diff-[0-9a-f]{64}L1$/u);
      });
      rightClick();
      await user.click(await screen.findByRole("menuitem", { name: "Copy Path" }));
      expect(p.onSay).toHaveBeenLastCalledWith("Path copied");
      expect(clipboard.at(-1)).toBe("src/old.ts");
    });

    it("offers no comment on an older range's lines", async () => {
      draw({ commentable: false });
      over(CART.path, 3);
      rightClick();
      const comment = await screen.findByRole("menuitem", { name: "Comment…" });
      expect(comment.getAttribute("aria-disabled")).toBe("true");
    });

    it("is about the lines picked in that file, across both sides", async () => {
      const user = setup();
      draw();
      pick(CART.path, { start: 2, end: 3, side: "deletions", endSide: "additions" });
      over(CART.path, 9);
      rightClick();
      expect((await screen.findByRole("menuitem", { name: "Copy Permalink" })).getAttribute("aria-disabled")).toBe(
        "true",
      );
      await user.click(screen.getByRole("menuitem", { name: "Copy Link to Diff" }));
      await waitFor(() => {
        expect(clipboard.at(-1)).toMatch(/L2-R3$/u);
      });
      pick(CART.path, { start: 4, end: 4, side: "additions", endSide: "additions" });
      over(CART.path, 9);
      rightClick();
      await user.click(await screen.findByRole("menuitem", { name: "Copy Permalink" }));
      await waitFor(() => {
        expect(clipboard.at(-1)).toBe("https://github.com/acme/app/blob/head1/src/cart.ts#L4");
      });
    });

    it("marks what's found in the files on screen, the current one apart, and again as they're drawn", () => {
      const { ref } = draw({ files: [CART, README] });
      ref.current!.find("promo", null);
      const host = document.createElement("diffs-container");
      const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      root.innerHTML = [
        '<code data-deletions><div data-line="3" data-line-type="change-deletion">old promo</div></code>',
        '<code data-additions><div data-line="3" data-line-type="change-addition">new promo, promo</div></code>',
        '<code><div data-line="5" data-line-type="change-deletion">gone promo</div>',
        '<div data-line="5" data-line-type="context">kept promo</div></code>',
      ].join("");
      const drawn = document.createElement("div");
      drawn.append(host);
      lib.instance = {
        getContainerElement: () => {},
        getRenderedItems: () => [
          { id: CART.path, element: drawn },
          { id: README.path, element: document.createElement("div") },
        ],
      };
      const highlights = new Map<string, { ranges: Range[] }>();
      vi.stubGlobal("CSS", { highlights });
      vi.stubGlobal(
        "Highlight",
        class {
          ranges: Range[];
          constructor(...ranges: Range[]) {
            this.ranges = ranges;
          }
        },
      );
      const texts = (name: string) => highlights.get(name)!.ranges.map((r) => r.startContainer.textContent);
      const drawnNow = lib.instance;
      lib.instance = undefined;
      ref.current!.find("promo", null);
      expect(highlights.get("find")!.ranges).toEqual([]);
      lib.instance = drawnNow;
      ref.current!.find("promo", { path: CART.path, side: "additions", line: 3, nth: 1 });
      expect(highlights.get("find")!.ranges).toHaveLength(5);
      expect(highlights.get("find-current")!.ranges.map((r) => r.startOffset)).toEqual([11]);
      ref.current!.find("promo", { path: CART.path, side: "deletions", line: 5, nth: 0 });
      expect(texts("find-current")).toEqual(["gone promo"]);
      ref.current!.find("promo", { path: CART.path, side: "additions", line: 5, nth: 0 });
      expect(texts("find-current")).toEqual(["kept promo"]);
      ref.current!.find("promo", { path: CART.path, side: "additions", line: 3, nth: 4 });
      expect(texts("find-current")).toEqual([]);
      highlights.clear();
      options().onPostRender(document.createElement("div"));
      expect(texts("find")).toHaveLength(5);
      ref.current!.find("", null);
      highlights.clear();
      options().onPostRender(document.createElement("div"));
      expect(highlights.size).toBe(0);
      vi.unstubAllGlobals();
    });

    it("names the library's expand controls once a file is drawn", () => {
      draw();
      const node = document.createElement("div");
      node.innerHTML = '<div role="button" data-expand-button data-expand-up></div>';
      options().onPostRender(node);
      expect(node.querySelector("[data-expand-button]")?.getAttribute("aria-label")).toBe("Show lines above");
    });

    it("has nothing once the pointer has left the line", async () => {
      draw();
      over(CART.path, 3);
      act(() => {
        options().onLineLeave();
        options().onLineEnter({ lineNumber: 1 }, { item: { id: README.path } });
        options().onLineEnter({ lineNumber: 1, annotationSide: "additions" });
      });
      const trigger = screen.getByTestId("code-view");
      fireEvent.contextMenu(trigger.parentElement!);
      await act(async () => {});
      expect(screen.queryByRole("menuitem")).toBeNull();
    });
  });

  describe("files GitHub sent no patch for", () => {
    it("loads one from both its versions, into the list", async () => {
      const user = setup();
      vi.mocked(bothVersions).mockResolvedValueOnce({ oldText: "a\n", newText: "a\nb\n" });
      const { p } = draw({ files: [CART, BIG], isViewed: (f) => f.path === BIG.path });
      expect(screen.getByText("No patch for data/big.json · viewed")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Mark data/big.json viewed" }));
      expect(p.onViewed).toHaveBeenCalledWith(BIG, true);
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      expect(bothVersions).toHaveBeenCalledWith(SOURCE, BIG);
      await waitFor(() => {
        expect(item(BIG.path)?.type).toBe("diff");
      });
      expect(screen.queryByText(/No patch for/u)).toBeNull();
    });

    it("loads a renamed one under its old name, and an added or deleted one from its one side", async () => {
      const user = setup();
      const gone = { ...BIG, path: "gone.json", status: "removed" as const };
      vi.mocked(bothVersions)
        .mockResolvedValueOnce({ oldText: "x", newText: "y" })
        .mockResolvedValueOnce({ oldText: null, newText: "y" })
        .mockResolvedValueOnce({ oldText: "x", newText: null });
      draw({ files: [LOGO, BIG, gone] });
      await user.click(screen.getByRole("button", { name: "Load logo.png" }));
      await waitFor(() => {
        expect(item(LOGO.path)?.fileDiff?.prevName).toBe("old-logo.png");
      });
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      await waitFor(() => {
        expect(item(BIG.path)?.fileDiff?.type).toBe("new");
      });
      await user.click(screen.getByRole("button", { name: "Load gone.json" }));
      await waitFor(() => {
        expect(item(gone.path)?.fileDiff?.type).toBe("deleted");
      });
    });

    it("says it's loading, and why it couldn't be", async () => {
      const user = setup();
      const loading = deferred<{ oldText: string | null; newText: string | null }>();
      vi.mocked(bothVersions)
        .mockReturnValueOnce(loading.promise)
        .mockRejectedValueOnce("offline")
        .mockRejectedValueOnce(new BinaryFile());
      draw({ files: [BIG] });
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      expect(screen.getByText("No patch for data/big.json · loading")).toBeTruthy();
      await act(async () => {
        loading.reject(new Error("Not Found"));
        await loading.promise.catch(() => {});
      });
      expect(screen.getByText("No patch for data/big.json · Couldn't load it: Not Found")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      expect(await screen.findByText("No patch for data/big.json · Couldn't load it: offline")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      expect(await screen.findByText("No patch for data/big.json · Binary file: not shown.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Load data/big.json" })).toBeNull();
    });

    it("can't be loaded before the pull request's head is known", async () => {
      const user = setup();
      draw({ files: [BIG], source: null });
      await user.click(screen.getByRole("button", { name: "Load data/big.json" }));
      expect(bothVersions).not.toHaveBeenCalled();
      expect(screen.queryByText(/loading/u)).toBeNull();
    });
  });

  describe("expanding the lines between hunks", () => {
    it("loads both versions of the file, the old under its old name", async () => {
      vi.mocked(bothVersions)
        .mockResolvedValueOnce({ oldText: "x\n", newText: "y\n" })
        .mockResolvedValueOnce({ oldText: null, newText: null })
        .mockResolvedValueOnce({ oldText: null, newText: "same\n" });
      draw({ files: [CART, MOVED] });
      const load = options().loadDiffFiles!;
      await expect(load({ name: MOVED.path, type: "rename-changed" })).resolves.toEqual({
        oldFile: { name: "src/old-name.ts", contents: "x\n" },
        newFile: { name: MOVED.path, contents: "y\n", cacheKey: "head1:src/new-name.ts" },
      });
      await expect(load({ name: CART.path, type: "change" })).resolves.toEqual({
        oldFile: { name: CART.path, contents: "" },
        newFile: { name: CART.path, contents: "", cacheKey: "head1:src/cart.ts" },
      });
      await expect(load({ name: MOVED.path, type: "rename-pure" })).resolves.toEqual({
        oldFile: null,
        newFile: { name: MOVED.path, contents: "same\n", cacheKey: "head1:src/new-name.ts" },
      });
      await expect(load({ name: "elsewhere.ts", type: "change" })).rejects.toThrow("elsewhere.ts");
    });
  });

  describe("going places", () => {
    it("scrolls to a file in the list, or to its card after it", () => {
      const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();
      Element.prototype.scrollIntoView = scrolled;
      const { ref } = draw({ files: [CART, BIG] });
      ref.current!.scrollToFile(CART.path);
      expect(lib.scrolled.at(-1)).toEqual({ type: "item", id: CART.path, align: "start" });
      ref.current!.scrollToFile(BIG.path);
      expect(scrolled).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      ref.current!.scrollToFile("nowhere.ts");
      expect(scrolled).toHaveBeenCalledOnce();
      ref.current!.scrollToTop();
      expect(lib.scrolled.at(-1)).toEqual({ type: "position", position: 0 });
      expect(ref.current!.listed()).toEqual([CART.path]);
    });

    it("scrolls to a line the diff shows, or else to its file", async () => {
      const user = setup();
      const { ref } = draw({ files: [CART, README] });
      ref.current!.scrollToLine(CART.path, 3);
      expect(lib.scrolled.at(-1)).toEqual({
        type: "line",
        id: CART.path,
        lineNumber: 3,
        side: "additions",
        align: "center",
        behavior: "smooth",
      });
      ref.current!.scrollToLine(CART.path, 2, "deletions");
      expect(lib.scrolled.at(-1)).toMatchObject({ lineNumber: 2, side: "deletions" });
      for (const line of [0, 50]) {
        ref.current!.scrollToLine(CART.path, line);
        expect(lib.scrolled.at(-1)).toEqual({ type: "item", id: CART.path, align: "start" });
      }
      await user.click(screen.getByRole("button", { name: "Show Rendered" }));
      ref.current!.scrollToLine(README.path, 1);
      expect(lib.scrolled.at(-1)).toEqual({ type: "item", id: README.path, align: "start" });
    });

    it("scrolls to a conversation where it's shown", () => {
      const onLine = thread();
      const moved = thread({ id: "t2", line: 40 });
      const { ref } = draw({ threads: new Map([[CART.path, [onLine, moved]]]) });
      ref.current!.scrollToThread(onLine);
      expect(lib.scrolled.at(-1)).toMatchObject({ type: "line", lineNumber: 2 });
      ref.current!.scrollToThread(moved);
      expect(lib.scrolled.at(-1)).toEqual({ type: "item", id: CART.path, align: "start" });
      ref.current!.scrollToThread(thread({ id: "unknown" }));
      expect(lib.scrolled.at(-1)).toEqual({ type: "item", id: CART.path, align: "start" });
    });

    it("says what's on screen and what's at the top", () => {
      const { ref } = draw({ files: [CART, README] });
      expect(ref.current!.onScreen()).toEqual([]);
      expect(ref.current!.atTop()).toBeNull();
      lib.instance = { getContainerElement: vi.fn<() => HTMLElement | undefined>(), getRenderedItems: () => [] };
      expect(ref.current!.onScreen()).toEqual([]);
      expect(ref.current!.atTop()).toBeNull();
      const items: Rendered[] = [
        { id: "above.ts", element: withRect(rect(-200, 100)) },
        { id: CART.path, element: withRect(rect(-50, 150)) },
        { id: README.path, element: withRect(rect(100, 400)) },
      ];
      lib.instance = { getContainerElement: () => withRect(rect(0, 300)), getRenderedItems: () => items };
      expect(ref.current!.onScreen()).toEqual([
        [CART.path, 100],
        [README.path, 200],
      ]);
      expect(ref.current!.atTop()).toEqual({ path: CART.path, reached: true });
      lib.instance = {
        getContainerElement: () => withRect(rect(0, 300)),
        getRenderedItems: () => [{ id: README.path, element: withRect(rect(100, 400)) }],
      };
      expect(ref.current!.atTop()).toEqual({ path: README.path, reached: false });
      lib.instance = {
        getContainerElement: () => withRect(rect(0, 300)),
        getRenderedItems: () => [{ id: "above.ts", element: withRect(rect(-200, 100)) }],
      };
      expect(ref.current!.atTop()).toBeNull();
    });
  });
});
