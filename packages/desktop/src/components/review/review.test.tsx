import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vite-plus/test";

import type { Diffs, DiffsHandle } from "@/components/diffs/diffs";
import type { FileTree } from "@/components/file-tree/file-tree";
import type { FilterBar } from "@/components/filter-bar/filter-bar";
import type { Overview } from "@/components/overview/overview";
import { Review, type Target } from "@/components/review/review";
import type { NewChanges } from "@/hooks/use-new-changes/use-new-changes";
import type { Visit } from "@/hooks/use-next-in-queue/use-next-in-queue";
import type { Stack } from "@/hooks/use-stack/use-stack";
import { aiProblem, ensureAi } from "@/utils/ai-ready/ai-ready";
import { askAboutLines, review as aiReview, type AiReview, type Finding } from "@/utils/ai/ai";
import type { Range } from "@/utils/commits/commits";
import { defaultConfig, loadConfig, type Config, type DiffFilter } from "@/utils/config/config";
import { mergeBase } from "@/utils/contents/contents";
import { comment, leaveReview, loadDetails, type Details } from "@/utils/details/details";
import { learnFiles } from "@/utils/estimate/estimate";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";
import { patchHash } from "@/utils/hashes/hashes";
import { keep, readKept, type Kept } from "@/utils/kept/kept";
import type { Args } from "@/utils/platform/platform";
import {
  commentNow,
  loadFiles,
  loadThreads,
  loadViewed,
  reply,
  setResolved,
  type Draft,
  type ReviewFile,
  type Thread,
  type ViewedState,
} from "@/utils/review/review";
import type { StackPull } from "@/utils/stack/stack";

type OverviewProps = ComponentProps<typeof Overview>;
type DiffsProps = Omit<ComponentProps<typeof Diffs>, "ref">;
type TreeProps = ComponentProps<typeof FileTree>;
type BarProps = ComponentProps<typeof FilterBar>;
type Banner = { loading: boolean; error: string | null; below: boolean };
type Options = { reloadAll: () => void };
type PullStub = {
  range: Range;
  setRange: Mock<(range: Range) => void>;
  view: Record<string, boolean> | null;
  menu: { close: Mock<() => void> };
  allowed: Record<string, boolean>;
  commits: { commits: unknown[] } | null;
  actions: { ready: Mock<() => Promise<void>> };
  busy: string | null;
};
type PendingStub = {
  drafts: Draft[];
  add: Mock<(draft: Omit<Draft, "key">) => void>;
  edit: Mock<(key: string, body: string) => void>;
  remove: Mock<(key: string) => void>;
  submit: Mock<(details: Details, event: string, body: string) => Promise<void>>;
  discard: Mock<(details: Details) => Promise<void>>;
};
type QueueStub = {
  next: Visit | null;
  previous: Visit | null;
  go: Mock<(done?: boolean) => Promise<boolean>>;
  goTo: Mock<(to: Visit) => Promise<void>>;
  back: Mock<() => Promise<void>>;
};

// What the window is made of has tests of its own: here each part shows it's there and hands back
// what it was given (kept in `h`), and the hooks around the pull request answer as the test says.
const h = vi.hoisted(() => {
  const make = {
    pull: (over: Partial<PullStub> = {}): PullStub => ({
      range: null,
      setRange: vi.fn<(range: Range) => void>(),
      view: null,
      menu: { close: vi.fn<() => void>() },
      allowed: { close: true },
      commits: null,
      actions: { ready: vi.fn<() => Promise<void>>(() => Promise.resolve()) },
      busy: null,
      ...over,
    }),
    pending: (drafts: Draft[] = []): PendingStub => ({
      drafts,
      add: vi.fn<(draft: Omit<Draft, "key">) => void>(),
      edit: vi.fn<(key: string, body: string) => void>(),
      remove: vi.fn<(key: string) => void>(),
      submit: vi.fn<(details: Details, event: string, body: string) => Promise<void>>(() => Promise.resolve()),
      discard: vi.fn<(details: Details) => Promise<void>>(() => Promise.resolve()),
    }),
    queue: (over: Partial<QueueStub> = {}): QueueStub => ({
      next: null,
      previous: null,
      go: vi.fn<(done?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
      goTo: vi.fn<(to: Visit) => Promise<void>>(() => Promise.resolve()),
      back: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      ...over,
    }),
  };
  const state = {
    mac: true,
    overview: null as OverviewProps | null,
    diffs: null as DiffsProps | null,
    tree: null as TreeProps | null,
    bar: null as BarProps | null,
    banner: null as Banner | null,
    handle: {
      scrollToFile: vi.fn<DiffsHandle["scrollToFile"]>(),
      scrollToLine: vi.fn<DiffsHandle["scrollToLine"]>(),
      scrollToThread: vi.fn<DiffsHandle["scrollToThread"]>(),
      scrollToTop: vi.fn<DiffsHandle["scrollToTop"]>(),
      listed: vi.fn<DiffsHandle["listed"]>(() => []),
      onScreen: vi.fn<DiffsHandle["onScreen"]>(() => []),
      atTop: vi.fn<DiffsHandle["atTop"]>(() => null),
    },
    pull: make.pull(),
    pending: make.pending(),
    queue: make.queue(),
    here: null as Visit | null,
    reload: vi.fn<() => Promise<void>>(),
    talk: null as Options | null,
    pullOptions: null as Options | null,
    newChanges: null as NewChanges | null,
    stack: null as Stack | null,
    onActivity: null as (() => void) | null,
    take: vi.fn<(path: string) => number>(() => 0),
    onScreen: null as (() => unknown) | null,
    aiProblem: null as { title: string; message: string } | null,
    ranged: { files: null as ReviewFile[] | null, error: null as string | null },
    onResult: null as ((message: string, ok: boolean) => void) | null,
  };
  // What the parts were given, noted as they draw.
  const see = {
    overview: (p: OverviewProps) => void (state.overview = p),
    diffs: (p: DiffsProps) => void (state.diffs = p),
    tree: (p: TreeProps) => void (state.tree = p),
    bar: (p: BarProps) => void (state.bar = p),
    banner: (p: Banner) => void (state.banner = p),
    result: (f: (message: string, ok: boolean) => void) => void (state.onResult = f),
    pull: (o: Options) => void (state.pullOptions = o),
    talk: (o: Options) => void (state.talk = o),
    here: (v: Visit | null) => void (state.here = v),
    activity: (f: () => void) => void (state.onActivity = f),
    screen: (f: () => unknown) => void (state.onScreen = f),
  };
  return Object.assign(state, { see, make });
});

vi.mock("@/utils/os/os", () => ({
  get isMac() {
    return h.mac;
  },
}));
vi.mock("@/components/overview/overview", () => ({
  Overview: (props: OverviewProps) => {
    h.see.overview(props);
    return <p>Overview of #{props.details.number}</p>;
  },
}));
vi.mock("@/components/diffs/diffs", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    Diffs: forwardRef<DiffsHandle, DiffsProps>(function Diffs(props, ref) {
      h.see.diffs(props);
      useImperativeHandle(ref, () => h.handle);
      return <p>Diff of {props.files.map((f) => f.path).join(", ")}</p>;
    }),
  };
});
vi.mock("@/components/file-tree/file-tree", () => ({
  FileTree: (props: TreeProps) => {
    h.see.tree(props);
    return null;
  },
}));
vi.mock("@/components/filter-bar/filter-bar", () => ({
  // Its children (the comments' button) as they are.
  FilterBar: (props: BarProps) => {
    h.see.bar(props);
    return props.children;
  },
}));
vi.mock("@/components/shortcuts/shortcuts", () => ({
  Shortcuts: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) =>
    open ? (
      <dialog open aria-label="Keyboard Shortcuts">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Done
        </button>
      </dialog>
    ) : null,
}));
vi.mock("@/components/commits/commits", () => ({
  RangePicker: ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => {
        onOpenChange(!open);
      }}
    >
      Changes
    </button>
  ),
  RangeBanner: (props: Banner) => {
    h.see.banner(props);
    return null;
  },
}));
vi.mock("@/components/pull-menus/pull-menus", () => ({
  MergeMenuItems: ({ onDetails }: { onDetails: () => void }) => (
    <button type="button" onClick={onDetails}>
      Merge details
    </button>
  ),
  PullMenuItems: () => null,
}));
vi.mock("@/components/action-buttons/action-buttons", () => ({
  ActionButtons: ({ onResult }: { onResult: (message: string, ok: boolean) => void }) => {
    h.see.result(onResult);
    return <span>Your actions</span>;
  },
  ActionMenuItems: () => null,
}));
vi.mock("@/components/suggestion/suggestion", () => ({ SuggestionBatch: () => null }));
vi.mock("@/hooks/use-pull/use-pull", () => ({
  usePull: (options: Options) => {
    h.see.pull(options);
    return h.pull;
  },
}));
vi.mock("@/hooks/use-conversation/use-conversation", () => ({
  ConversationProvider: ({ children }: { children: ReactNode }) => children,
  useConversation: (options: Options) => {
    h.see.talk(options);
    return { conversation: null, reload: h.reload, api: null };
  },
}));
vi.mock("@/hooks/use-pending/use-pending", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  usePending: () => h.pending,
}));
vi.mock("@/hooks/use-next-in-queue/use-next-in-queue", () => ({
  useNextInQueue: (_queue: unknown, _current: string, here: Visit | null) => {
    h.see.here(here);
    return h.queue;
  },
}));
vi.mock("@/hooks/use-stack/use-stack", () => ({ useStack: () => h.stack }));
vi.mock("@/hooks/use-new-changes/use-new-changes", () => ({
  useNewChanges: (_repo: string, _number: number, _head: unknown, _updated: unknown, onActivity: () => void) => {
    h.see.activity(onActivity);
    return h.newChanges;
  },
}));
vi.mock("@/hooks/use-active-time/use-active-time", () => ({
  useActiveTime: (onScreen: () => unknown) => {
    h.see.screen(onScreen);
    return h.take;
  },
}));
vi.mock("@/utils/ai-ready/ai-ready", () => ({
  aiProblem: vi.fn<typeof aiProblem>(),
  ensureAi: vi.fn<typeof ensureAi>(),
  useAiProblem: () => h.aiProblem,
}));
vi.mock("@/utils/ai/ai", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  review: vi.fn<typeof aiReview>(),
  askAboutLines: vi.fn<typeof askAboutLines>(),
}));
vi.mock("@/utils/commits/commits", () => ({ useRangeFiles: () => h.ranged }));
vi.mock("@/utils/config/config", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadConfig: vi.fn<typeof loadConfig>(),
}));
vi.mock("@/utils/contents/contents", () => ({ mergeBase: vi.fn<typeof mergeBase>() }));
vi.mock("@/utils/details/details", () => ({
  comment: vi.fn<typeof comment>(),
  leaveReview: vi.fn<typeof leaveReview>(),
  loadDetails: vi.fn<typeof loadDetails>(),
}));
vi.mock("@/utils/estimate/estimate", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useLearned: () => null,
  learnFiles: vi.fn<typeof learnFiles>(),
}));
vi.mock("@/utils/kept/kept", () => ({ keep: vi.fn<typeof keep>(), readKept: vi.fn<typeof readKept>() }));
vi.mock("@/utils/review/review", () => ({
  commentNow: vi.fn<typeof commentNow>(),
  loadFiles: vi.fn<typeof loadFiles>(),
  loadThreads: vi.fn<typeof loadThreads>(),
  loadViewed: vi.fn<typeof loadViewed>(),
  reply: vi.fn<typeof reply>(),
  setResolved: vi.fn<typeof setResolved>(),
}));
vi.mock("@/utils/theme/theme", () => ({ useTheme: () => {} }));

// MARK: Sample data

const details = (over: Partial<Details> = {}): Details => ({
  id: "PR_7",
  number: 7,
  title: "Keep the promo code",
  url: "https://github.com/acme/shop/pull/7",
  html: "",
  owner: "acme",
  repo: "shop",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "keep-promo",
  headRefOid: "head1",
  updatedAt: "2026-10-01T10:00:00Z",
  additions: 3,
  deletions: 1,
  changedFiles: 4,
  createdAt: "2026-10-01T09:00:00Z",
  author: { login: "ana", name: "Ana Lima" },
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
  ...over,
});

const file = (path: string, patch = `@@ -1 +1 @@\n-old ${path}\n+new ${path}`): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch,
});
const A = file("src/cart.ts");
const B = file("src/promo.ts");
const DOC = file("docs/promo.md");
const BIN = file("img.png", "");
const FILES = [A, B, DOC, BIN];

const thread = (id: string, path: string, line: number, over: Partial<Thread> = {}): Thread => ({
  id,
  path,
  side: "additions",
  line,
  resolved: false,
  outdated: false,
  comments: [{ id: `${id}-1`, databaseId: 1, author: { login: "bo" }, html: "<p>Hm</p>", at: "", url: "" }],
  ...over,
});

const draft = (key: string, path: string, line: number): Draft => ({ key, path, line, side: "additions", body: "Nit" });

const finding = (path: string, line: number, inDiff = true): Finding => ({
  path,
  line,
  severity: "issue",
  body: `About ${path}:${line}`,
  inDiff,
});

const DOCS: DiffFilter = { id: "docs", name: "Docs", include: "^docs/", exclude: "", repos: [] };
const CODE: DiffFilter = { id: "code", name: "Code", include: "^src/", exclude: "", repos: [] };

const config = (over: Partial<Config> = {}, ai: Partial<Config["ai"]> = {}): Config => {
  const base = defaultConfig();
  return {
    ...base,
    queues: [{ ...base.queues[0]!, id: "q1", name: "Waiting on me" }],
    ...over,
    ai: { ...base.ai, ...ai },
  };
};
const withAi = (ai: Partial<Config["ai"]> = {}, over: Partial<Config> = {}) =>
  config(over, { provider: "claude", ...ai });

const aiReviewOf = (findings: Finding[]): AiReview => ({ summary: "Fine", findings, project: false, at: 1 });

const visit = (number: number, title: string): Visit => ({
  pr: { id: `PR_${number}`, number, title, repository: { nameWithOwner: "acme/shop" }, author: null },
  teams: [],
  queue: "q1",
});

/** A promise settled when the test says. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** What's kept on this machine under a key. */
const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? "null");

// MARK: Rust's side

let calls: Array<{ cmd: string; args: Args | undefined }> = [];
let confirmed = true;
const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);
const fail = (message: string) => () => {
  throw new Error(message);
};
/** Answers the app's commands: these as the test says, the rest as a signed-in Mac would. */
function answer(answers: Record<string, () => unknown> = {}) {
  const usual: Record<string, () => unknown> = {
    auth_status: () => ({ login: "me" }),
    confirm: () => confirmed,
    queued_viewed: () => ({}),
  };
  mockCommands((cmd, args) => {
    calls.push({ cmd, args });
    return (answers[cmd] ?? usual[cmd])?.() ?? null;
  });
}

beforeEach(() => {
  h.mac = true;
  h.overview = null;
  h.diffs = null;
  h.tree = null;
  h.bar = null;
  h.banner = null;
  h.here = null;
  h.newChanges = null;
  h.stack = null;
  h.aiProblem = null;
  h.onResult = null;
  h.ranged = { files: null, error: null };
  for (const f of Object.values(h.handle)) f.mockClear();
  h.handle.listed.mockReturnValue([]);
  h.handle.onScreen.mockReturnValue([]);
  h.handle.atTop.mockReturnValue(null);
  h.take.mockReturnValue(0);
  h.reload.mockImplementation(() => Promise.resolve());
  h.pull = h.make.pull();
  h.pending = h.make.pending();
  h.queue = h.make.queue();
  vi.mocked(loadConfig).mockResolvedValue(config());
  vi.mocked(readKept).mockResolvedValue(null);
  vi.mocked(keep).mockImplementation(() => Promise.resolve());
  vi.mocked(loadDetails).mockResolvedValue(details());
  vi.mocked(loadFiles).mockResolvedValue(FILES);
  vi.mocked(loadThreads).mockResolvedValue([]);
  vi.mocked(loadViewed).mockResolvedValue(new Map());
  vi.mocked(ensureAi).mockResolvedValue(true);
  vi.mocked(aiProblem).mockResolvedValue(null);
  vi.mocked(learnFiles).mockImplementation(() => Promise.resolve());
  vi.mocked(mergeBase).mockResolvedValue("base1");
  calls = [];
  confirmed = true;
  answer();
});

// The menu bar's listener lets go after the window closes: before the fake platform is cleared.
afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await act(() => wait(0));
});

const TARGET: Target = { id: "PR_7", repo: "acme/shop", number: 7, teams: ["acme/web"], queue: "q1" };

/** The window for a pull request, once its details and files are in. */
async function openReview(target: Target = TARGET) {
  const view = render(<Review target={target} />);
  await screen.findByRole("heading", { level: 1, name: "Keep the promo code" });
  await waitFor(() => {
    expect(keep).toHaveBeenCalled();
  });
  return view;
}

const wait = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`, "u") });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (key: string, init: KeyboardEventInit = {}) => {
  fireEvent.keyDown(window, { key, ...init });
};
const chord = (code: string) => {
  fireEvent.keyDown(window, { key: "x", code, altKey: true, shiftKey: true });
};
const menu = async (id: string) => {
  await act(() => emit("menu", id));
};
const diffs = () => h.diffs!;
/** Runs what was put off to the next frames. */
const frames = () => act(() => wait(50));
/** The toolbar this wide, its trailing end starting here (happy-dom lays nothing out). */
function layOut(size: { bar: number; trailing: number }) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.bar);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return this.querySelector("[role=tablist]") ? 0 : size.trailing;
  });
}
const states = (entries: Array<[string, ViewedState]>) => new Map(entries);
const kinds = () => within(screen.getByRole("group", { name: "Kind of review" }));
/** The comments from the AI, from your pending review, and a conversation, to step through. */
const someComments = () => {
  vi.mocked(loadThreads).mockResolvedValue([
    thread("T1", "src/promo.ts", 4),
    thread("T2", "src/promo.ts", 2, { resolved: true }),
    thread("T3", "gone.ts", 1),
  ]);
  h.pending = h.make.pending([draft("d1", "src/cart.ts", 9), draft("d2", "src/promo.ts", 0)]);
  localStorage.setItem(
    "ai-review:PR_7",
    JSON.stringify({
      head: "head1",
      review: aiReviewOf([finding("src/cart.ts", 3), finding("src/cart.ts", 7, false)]),
    }),
  );
};

// MARK: Tests

describe("Review", () => {
  describe("loading", () => {
    it("holds the places of what's coming, then shows the pull request", async () => {
      const later = deferred<Details>();
      vi.mocked(loadDetails).mockReturnValue(later.promise);
      render(<Review target={TARGET} />);
      expect(screen.getByLabelText("Loading")).toBeTruthy();
      // The files come first: the list shows them before the details are in.
      await waitFor(() => {
        expect(h.diffs).not.toBeNull();
      });
      await act(async () => {
        await diffs().onCommentNow({ path: "src/cart.ts", side: "additions", line: 1, body: "x" });
        await diffs().onReply(thread("T", "src/cart.ts", 1), "x");
      });
      expect(commentNow).not.toHaveBeenCalled();
      expect(reply).not.toHaveBeenCalled();
      // Activity before the first showing has nothing kept to bring up to date.
      const entries: Details["entries"] = [{ kind: "comment", id: "c", author: null, html: "", at: "", url: "" }];
      vi.mocked(loadThreads).mockResolvedValueOnce([]);
      vi.mocked(loadDetails).mockResolvedValueOnce(details({ entries }));
      await act(async () => {
        h.onActivity!();
        await Promise.resolve();
      });
      act(() => {
        later.resolve(details({ entries }));
      });
      await screen.findByRole("heading", { level: 1, name: "Keep the promo code" });
      expect(screen.getByText("Overview of #7")).toBeTruthy();
      expect(tab("Overview").textContent).toBe("Overview1");
      expect(tab("Diff").textContent).toBe("Diff4");
      expect(screen.getByText(/acme\/shop #7 · Ana ·/u).textContent).toContain("keep-promo");
    });

    it("says why it couldn't load, and tries again", async () => {
      vi.mocked(loadDetails).mockRejectedValueOnce(new Error("Bad credentials"));
      render(<Review target={TARGET} />);
      expect((await screen.findByRole("alert")).textContent).toBe("Bad credentials");
      vi.mocked(loadDetails).mockRejectedValueOnce("offline");
      await userEvent.click(button("Try again"));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe("offline");
      });
      await userEvent.click(button("Try again"));
      await screen.findByRole("heading", { level: 1, name: "Keep the promo code" });
    });

    it("shows the copy kept from last time at once, then asks only for what changed", async () => {
      const kept: Kept = { details: details(), files: [A], threads: [thread("T1", "src/cart.ts", 1)] };
      vi.mocked(readKept).mockResolvedValue(kept);
      await openReview();
      expect(loadFiles).not.toHaveBeenCalled();
      expect(loadThreads).not.toHaveBeenCalled();
      expect(diffs().files.map((f) => f.path)).toEqual(["src/cart.ts"]);
    });

    it("loads the files again for a new head, and the conversations for a newer pull request", async () => {
      const kept: Kept = { details: details({ headRefOid: "old", updatedAt: "then" }), files: [A], threads: [] };
      vi.mocked(readKept).mockResolvedValue(kept);
      await openReview();
      expect(loadFiles).toHaveBeenCalledWith({ owner: "acme", repo: "shop", number: 7 }, 4);
      expect(loadThreads).toHaveBeenCalled();
      await waitFor(() => {
        expect(diffs().files).toHaveLength(4);
      });
    });

    it("doesn't put the kept copy back over what a reload already showed", async () => {
      const first = deferred<Kept | null>();
      const second = deferred<Kept | null>();
      vi.mocked(readKept).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<Review target={TARGET} />);
      await waitFor(() => {
        expect(h.talk).not.toBeNull();
      });
      act(() => {
        h.talk!.reloadAll();
      });
      await act(async () => {
        first.resolve(null);
        await wait(10);
      });
      expect(keep).toHaveBeenCalledTimes(1);
      await act(async () => {
        second.resolve({ details: details({ title: "Old title" }), files: [], threads: [] });
        await wait(10);
      });
      expect(screen.queryByText("Old title")).toBeNull();
      expect(keep).toHaveBeenCalledTimes(2);
    });

    it("reloads everything when the conversation or the pull request's tools ask", async () => {
      await openReview();
      vi.mocked(loadDetails).mockClear();
      act(() => {
        h.pullOptions!.reloadAll();
      });
      await waitFor(() => {
        expect(loadDetails).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("viewed files", () => {
    it("follows what you viewed on github.com, and sends GitHub what was marked here", async () => {
      const C = file("src/c.ts");
      const D = file("src/d.ts");
      const E = file("src/e.ts");
      const F = file("src/f.ts");
      const G = file("src/g.ts");
      vi.mocked(loadFiles).mockResolvedValue([A, B, C, D, E, F, G]);
      localStorage.setItem(
        "viewed:PR_7",
        JSON.stringify({
          "src/cart.ts": patchHash(A),
          "src/promo.ts": "",
          "src/c.ts": "before",
          "src/d.ts": "x",
          "src/g.ts": patchHash(G),
        }),
      );
      vi.mocked(loadViewed).mockResolvedValue(
        states([
          ["src/cart.ts", "UNVIEWED"],
          ["src/promo.ts", "VIEWED"],
          ["src/c.ts", "VIEWED"],
          ["src/d.ts", "UNVIEWED"],
          ["src/f.ts", "VIEWED"],
          ["src/g.ts", "VIEWED"],
        ]),
      );
      // Waiting to go to GitHub already: what's marked here stands.
      answer({ queued_viewed: () => ({ "src/f.ts": false }) });
      await openReview();
      await waitFor(() => {
        expect(sent("queue_viewed")).toHaveLength(2);
      });
      expect(sent("queue_viewed")).toEqual([
        { pull: "PR_7", path: "src/cart.ts", viewed: true },
        { pull: "PR_7", path: "src/promo.ts", viewed: false },
      ]);
      // cart (here), c (GitHub's, at these changes), g: viewed; d dropped; f waits.
      await waitFor(() => {
        expect(screen.getByText("3/7 viewed")).toBeTruthy();
      });
      expect(stored("viewed:PR_7")).not.toHaveProperty(["src/d.ts"]);
    });

    it("keeps what's marked here when GitHub's marks can't be read", async () => {
      localStorage.setItem("viewed:PR_7", JSON.stringify({ "src/cart.ts": patchHash(A) }));
      vi.mocked(loadViewed).mockRejectedValue(new Error("no"));
      answer({ queued_viewed: fail("gone") });
      await openReview();
      expect(screen.getByText("1/4 viewed")).toBeTruthy();
    });

    it("ignores marks kept in a shape it doesn't know", async () => {
      localStorage.setItem("viewed:PR_7", JSON.stringify({ "src/cart.ts": 1 }));
      await openReview();
      expect(screen.getByText("0/4 viewed")).toBeTruthy();
    });

    it("marks a file viewed here and on GitHub, learning the reader's pace from the time it took", async () => {
      await openReview();
      h.take.mockReturnValueOnce(90);
      act(() => {
        diffs().onViewed(A, true);
      });
      expect(vi.mocked(learnFiles).mock.lastCall?.[0]).toMatchObject([{ path: "src/cart.ts", actual: 1.5 }]);
      expect(sent("queue_viewed").at(-1)).toEqual({ pull: "PR_7", path: "src/cart.ts", viewed: true });
      expect(diffs().isViewed(A)).toBe(true);
      // A glance isn't a review: nothing learned.
      act(() => {
        diffs().onViewed(B, true);
      });
      expect(learnFiles).toHaveBeenCalledTimes(1);
      act(() => {
        diffs().onViewed(A, false);
      });
      expect(diffs().isViewed(A)).toBe(false);
      expect(stored("viewed:PR_7")).toHaveProperty(["src/cart.ts"], "");
    });

    it("hides viewed files on request, except one opened to show a comment", async () => {
      await openReview();
      act(() => {
        diffs().onViewed(A, true);
        diffs().onViewed(B, true);
      });
      await userEvent.click(tab("Diff"));
      await userEvent.click(screen.getByRole("checkbox"));
      expect(diffs().files.map((f) => f.path)).not.toContain("src/cart.ts");
      act(() => {
        h.overview!.onJump("src/cart.ts", null);
      });
      expect(diffs().files.map((f) => f.path)).toContain("src/cart.ts");
      expect(diffs().opened.has("src/cart.ts")).toBe(true);
      // Marked again, it folds away like the rest.
      act(() => {
        diffs().onViewed(A, true);
      });
      expect(diffs().files.map((f) => f.path)).not.toContain("src/cart.ts");
    });

    it("keeps working when the marks can't be saved", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("full");
      });
      await openReview();
      act(() => {
        diffs().onViewed(A, true);
      });
      expect(diffs().isViewed(A)).toBe(true);
    });
  });

  describe("toolbar", () => {
    it("switches between Overview and Diff, and remembers which for the pull request", async () => {
      const view = await openReview();
      expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector<HTMLElement>("#panel-diff")!.hidden).toBe(true);
      await userEvent.click(tab("Diff"));
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
      view.unmount();
      await openReview();
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
    });

    it("centres the title while there's room for it, and gives it what's between the ends when not", async () => {
      const size = { bar: 1200, trailing: 1000 };
      layOut(size);
      const view = await openReview();
      const title = screen.getByRole("heading", { level: 1 }).parentElement!;
      expect(title.style.left).toBe("216px");
      expect(title.style.right).toBe("216px");
      view.unmount();
      size.bar = 400;
      size.trailing = 300;
      await openReview();
      const narrow = screen.getByRole("heading", { level: 1 }).parentElement!;
      expect([narrow.style.left, narrow.style.right]).toEqual(["16px", "116px"]);
    });

    it("draws the toolbar's edge once something scrolls under it", async () => {
      await openReview();
      const header = screen.getByRole("banner");
      expect(header.className).not.toContain("shadow-");
      const panel = screen.getByRole("tabpanel", { name: /Overview/u });
      panel.scrollTop = 40;
      fireEvent.scroll(panel);
      expect(header.className).toContain("shadow-");
    });

    it("leaves room for the traffic lights only on a Mac", async () => {
      h.mac = false;
      await openReview();
      expect(screen.getByRole("banner").className).toContain("h-11");
    });

    it("says what just happened in place of the branch line, for a moment", async () => {
      await openReview();
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      act(() => {
        h.overview!.say("Link copied");
      });
      expect(screen.getByRole("status").textContent).toBe("Link copied");
      act(() => {
        vi.advanceTimersByTime(2000);
        h.overview!.say("Path copied");
      });
      // The first one's time is up, but a newer message stays.
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByRole("status").textContent).toBe("Path copied");
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("lays the diff out side by side or in one column, wraps it, hides whitespace: kept for next time", async () => {
      localStorage.setItem("diff-style", JSON.stringify("bogus"));
      localStorage.setItem("diff-wrap", "not json");
      const view = await openReview();
      expect(diffs().diffStyle).toBe("split");
      expect(diffs().wrap).toBe(false);
      await userEvent.click(tab("Diff"));
      await userEvent.click(button("One Column"));
      expect(diffs().diffStyle).toBe("unified");
      // Pressing the one that's on leaves it on.
      await userEvent.click(button("One Column"));
      expect(diffs().diffStyle).toBe("unified");
      await userEvent.click(button("Wrap long lines"));
      await userEvent.click(button("Hide whitespace changes"));
      expect(diffs().wrap).toBe(true);
      expect(diffs().whitespace).toBe(true);
      view.unmount();
      localStorage.setItem("tab:PR_7", JSON.stringify("overview"));
      await openReview();
      expect(diffs().diffStyle).toBe("unified");
      expect(diffs().wrap).toBe(true);
      expect(diffs().whitespace).toBe(true);
    });

    it("follows the app's appearance into the diff", async () => {
      await openReview();
      expect(diffs().dark).toBe(false);
      act(() => {
        document.documentElement.classList.add("dark");
      });
      await waitFor(() => {
        expect(diffs().dark).toBe(true);
      });
      document.documentElement.classList.remove("dark");
    });
  });

  describe("stepping through comments", () => {
    it("counts the open comments in the files' order and goes to each, round and round", async () => {
      someComments();
      await openReview();
      await userEvent.click(tab("Diff"));
      // In the floating bar: opening its card goes to the first.
      await userEvent.click(button("Comments, 4 comments"));
      expect(screen.getByLabelText("Comment 1 of 4")).toBeTruthy();
      await frames();
      // The AI's on cart.ts line 3 comes first, then your pending line 9.
      expect(h.handle.scrollToLine).toHaveBeenLastCalledWith("src/cart.ts", 3, "additions");
      press("n");
      await frames();
      expect(h.handle.scrollToLine).toHaveBeenLastCalledWith("src/cart.ts", 9, "additions");
      press("n");
      await frames();
      // On the file as a whole: its top.
      expect(h.handle.scrollToFile).toHaveBeenLastCalledWith("src/promo.ts");
      press("n");
      await frames();
      expect(h.handle.scrollToThread).toHaveBeenCalledWith(expect.objectContaining({ id: "T1" }));
      press("p");
      press("p");
      press("p");
      press("p");
      expect(screen.getByLabelText("Comment 4 of 4")).toBeTruthy();
      await userEvent.click(button("Previous comment"));
      expect(screen.getByLabelText("Comment 3 of 4")).toBeTruthy();
    });

    it("brings a comment into view past the search, the filters and its file's folding", async () => {
      someComments();
      vi.mocked(loadConfig).mockResolvedValue(config({ filters: [DOCS] }));
      localStorage.setItem("filter:acme/shop", JSON.stringify(["docs"]));
      await openReview();
      await userEvent.click(tab("Diff"));
      await userEvent.type(screen.getByRole("searchbox"), "docs");
      act(() => {
        h.overview!.onJump("src/cart.ts", 3);
      });
      expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("");
      expect(stored("filter:acme/shop")).toEqual([]);
      // Already showing, in what's chosen and matching the search: left as it is.
      await userEvent.type(screen.getByRole("searchbox"), "cart");
      act(() => {
        h.overview!.onJump("src/cart.ts", 3);
      });
      expect(screen.getByRole<HTMLInputElement>("searchbox").value).toBe("cart");
      await frames();
      expect(h.tree!.picked).toBe("src/cart.ts");
    });

    it("has nothing to step through without open comments", async () => {
      await openReview();
      await userEvent.click(tab("Diff"));
      expect(button("Comments, No open comments").getAttribute("aria-disabled")).toBe("true");
      await menu("next-comment");
      // Not a key of the Diff's.
      press("x");
      press("p");
      expect(h.handle.scrollToLine).not.toHaveBeenCalled();
    });

    it("steps only in the Diff, and not with ⌥", async () => {
      someComments();
      await openReview();
      press("n");
      expect(screen.queryByText(/Comment 1 of/u)).toBeNull();
      await userEvent.click(tab("Diff"));
      press("n", { altKey: true });
      expect(screen.queryByText(/Comment 1 of/u)).toBeNull();
    });

    it("shows the old review only for the head it was made of", async () => {
      localStorage.setItem(
        "ai-review:PR_7",
        JSON.stringify({ head: "older", review: aiReviewOf([finding("src/cart.ts", 3)]) }),
      );
      await openReview();
      expect(h.overview!.review).toBeNull();
      expect(diffs().findings).toEqual([]);
    });
  });

  describe("the files", () => {
    it("filters the list by what's typed, Esc or the clear button emptying it", async () => {
      await openReview();
      await userEvent.click(tab("Diff"));
      const search = screen.getByRole("searchbox");
      await userEvent.type(search, "PROMO");
      expect(diffs().files.map((f) => f.path)).toEqual(["docs/promo.md", "src/promo.ts"]);
      expect(h.tree!.flat).toBe(true);
      await frames();
      expect(h.handle.scrollToTop).toHaveBeenCalled();
      await userEvent.click(button("Clear"));
      expect(diffs().files).toHaveLength(4);
      await userEvent.type(search, "zzz");
      expect(screen.getByText("No files match.")).toBeTruthy();
      // No list to step through.
      press("j");
      fireEvent.keyDown(search, { key: "Escape" });
      expect(diffs().files).toHaveLength(4);
      // Empty already: Esc is the window's.
      const esc = fireEvent.keyDown(search, { key: "Escape" });
      expect(esc).toBe(true);
      fireEvent.keyDown(search, { key: "a" });
    });

    it("goes to the file picked in the tree and counts its open conversations", async () => {
      vi.mocked(loadThreads).mockResolvedValue([
        thread("T1", "src/cart.ts", 1),
        thread("T2", "src/cart.ts", 2, { resolved: true }),
      ]);
      await openReview();
      act(() => {
        h.tree!.onPick("src/cart.ts");
      });
      expect(h.handle.scrollToFile).toHaveBeenCalledWith("src/cart.ts");
      expect(h.tree!.picked).toBe("src/cart.ts");
      expect(h.tree!.comments("src/cart.ts")).toBe(1);
      expect(h.tree!.comments("src/promo.ts")).toBe(0);
    });

    it("shows the parts chosen in the filter bar, kept for the repository", async () => {
      vi.mocked(loadConfig).mockResolvedValue(config({ filters: [DOCS, CODE] }));
      await openReview();
      act(() => {
        h.bar!.onToggle("docs");
      });
      expect(diffs().files.map((f) => f.path)).toEqual(["docs/promo.md"]);
      expect(localStorage.getItem("filter:acme/shop")).toBe('["docs"]');
      await frames();
      expect(h.handle.scrollToTop).toHaveBeenCalled();
      // All done in Docs: the bar offers the next part with work.
      act(() => {
        diffs().onViewed(DOC, true);
      });
      expect(h.bar!.next).toMatchObject({ left: 0, nextFilter: { id: "code" } });
      act(() => {
        h.bar!.onNextFile();
      });
      expect(h.bar!.chosen).toEqual(["code"]);
    });

    it("goes to the next file left to review, after the one at the top", async () => {
      await openReview();
      h.handle.atTop.mockReturnValue({ path: "docs/promo.md", reached: true });
      act(() => {
        h.bar!.onNextFile();
      });
      await frames();
      expect(h.handle.scrollToFile).toHaveBeenCalledWith("src/cart.ts");
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
    });

    it("has nowhere to go when every file is viewed and no part has work", async () => {
      await openReview();
      act(() => {
        FILES.forEach((f) => {
          diffs().onViewed(f, true);
        });
      });
      act(() => {
        h.bar!.onNextFile();
      });
      await frames();
      expect(h.handle.scrollToFile).not.toHaveBeenCalled();
    });

    it("says when the chosen parts have nothing in the commits shown", async () => {
      vi.mocked(loadConfig).mockResolvedValue(config({ filters: [DOCS] }));
      localStorage.setItem("filter:acme/shop", JSON.stringify("docs"));
      h.pull = h.make.pull({ range: { from: "c1", to: "head1" } });
      h.ranged = { files: [A], error: null };
      await openReview();
      expect(screen.getByText("No files in Docs.")).toBeTruthy();
    });

    it("shows a range of commits: its files, its two ends to expand from, no conversations on older lines", async () => {
      vi.mocked(loadThreads).mockResolvedValue([thread("T1", "src/cart.ts", 1)]);
      h.pull = h.make.pull({ range: { from: "c1", to: "c2" } });
      h.ranged = { files: null, error: null };
      await openReview();
      expect(h.banner!.loading).toBe(true);
      expect(screen.getByLabelText("Loading files")).toBeTruthy();
      h.ranged = { files: [A], error: null };
      act(() => {
        h.overview!.say("rerender");
      });
      expect(diffs().files).toEqual([A]);
      expect(diffs().commentable).toBe(false);
      expect(diffs().threads.size).toBe(0);
      expect(diffs().source!.head).toBe("c2");
      await expect(diffs().source!.base()).resolves.toBe("c1");
    });

    it("expands lines from the head and the merge base, and links to them", async () => {
      await openReview();
      expect(diffs().commentable).toBe(true);
      expect(diffs().link).toEqual({ owner: "acme", repo: "shop", number: 7, head: "head1" });
      await expect(diffs().source!.base()).resolves.toBe("base1");
      expect(mergeBase).toHaveBeenCalledWith({ owner: "acme", repo: "shop", number: 7 }, "head1");
    });

    it("has no bar or progress without files", async () => {
      vi.mocked(loadFiles).mockResolvedValue([]);
      await openReview();
      expect(h.bar).toBeNull();
      expect(screen.getByText("0/0 viewed")).toBeTruthy();
      expect(h.onScreen!()).toEqual([]);
    });

    it("tells the time spent which files are on screen", async () => {
      await openReview();
      h.handle.onScreen.mockReturnValue([["src/cart.ts", 300]]);
      expect(h.onScreen!()).toEqual([["src/cart.ts", 300]]);
    });
  });

  describe("keyboard", () => {
    it("j, k and v: next file, previous file, viewed", async () => {
      await openReview();
      await userEvent.click(tab("Diff"));
      h.handle.listed.mockReturnValue(["src/cart.ts", "src/promo.ts"]);
      h.handle.atTop.mockReturnValue({ path: "src/cart.ts", reached: true });
      press("j");
      expect(h.handle.scrollToFile).toHaveBeenLastCalledWith("src/promo.ts");
      expect(h.tree!.picked).toBe("src/promo.ts");
      press("k");
      expect(h.handle.scrollToFile).toHaveBeenLastCalledWith("src/cart.ts");
      press("v");
      expect(diffs().isViewed(A)).toBe(true);
      press("v");
      expect(diffs().isViewed(A)).toBe(false);
      // Nothing at the top, or nothing listed: nothing to do.
      h.handle.atTop.mockReturnValue(null);
      press("v");
      h.handle.listed.mockReturnValue([]);
      h.handle.scrollToFile.mockClear();
      press("j");
      expect(h.handle.scrollToFile).not.toHaveBeenCalled();
    });

    it("leaves keys alone in text fields, when taken already, and with ⌘ or ⌃", async () => {
      await openReview();
      await userEvent.click(tab("Diff"));
      h.handle.listed.mockReturnValue(["src/cart.ts"]);
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "j" });
      press("j", { ctrlKey: true });
      press("?", { metaKey: true });
      const taken = new KeyboardEvent("keydown", { key: "j", cancelable: true });
      taken.preventDefault();
      window.dispatchEvent(taken);
      expect(h.handle.scrollToFile).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("? shows every shortcut, from either tab", async () => {
      await openReview();
      press("?");
      expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeTruthy();
      await userEvent.click(button("Done"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("⌥⇧ and a key: next and previous part, all files, next file to review", async () => {
      vi.mocked(loadConfig).mockResolvedValue(
        config({ filters: [DOCS, CODE, { ...DOCS, id: "none", include: "^nothing/" }] }),
      );
      await openReview();
      chord("Period");
      expect(h.bar!.chosen).toEqual(["docs"]);
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
      chord("Period");
      expect(h.bar!.chosen).toEqual(["code"]);
      // Parts with no files here are passed over.
      chord("Period");
      expect(h.bar!.chosen).toEqual([]);
      chord("Comma");
      expect(h.bar!.chosen).toEqual(["code"]);
      chord("Digit0");
      expect(h.bar!.chosen).toEqual([]);
      chord("KeyJ");
      await frames();
      expect(h.handle.scrollToFile).toHaveBeenCalledWith("docs/promo.md");
      chord("KeyQ");
    });

    it("⌥⇧ waits for the files", async () => {
      vi.mocked(loadConfig).mockResolvedValue(config({ filters: [DOCS] }));
      localStorage.setItem("filter:acme/shop", JSON.stringify(["docs"]));
      vi.mocked(loadFiles).mockReturnValue(deferred<ReviewFile[]>().promise);
      vi.mocked(loadDetails).mockResolvedValue(details());
      render(<Review target={TARGET} />);
      await screen.findByRole("heading", { level: 1 });
      fireEvent.keyDown(window, { key: "x", code: "Period", altKey: true, shiftKey: true });
      press("j");
      expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
    });
  });

  describe("the AI", () => {
    it("reviews on request, then offers to again; its comments go to your review or away", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      const one = finding("src/cart.ts", 3);
      const two = finding("src/promo.ts", 1);
      vi.mocked(aiReview).mockResolvedValue(aiReviewOf([one, two]));
      await openReview();
      expect(diffs().findingsBy).toBe("Claude Code");
      await userEvent.click(button("AI Review"));
      await waitFor(() => {
        expect(h.overview!.review?.findings).toHaveLength(2);
      });
      expect(button("Review Again")).toBeTruthy();
      act(() => {
        diffs().onAcceptFinding({ ...one }, "additions");
      });
      expect(h.pending.add).toHaveBeenCalledWith({ path: "src/cart.ts", side: "additions", line: 3, body: one.body });
      expect(diffs().findings).toEqual([two]);
      act(() => {
        diffs().onDismissFinding(two);
      });
      expect(diffs().findings).toEqual([]);
    });

    it("can't be asked again while it reviews, nor before the files are in", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      const files = deferred<ReviewFile[]>();
      vi.mocked(loadFiles).mockReturnValue(files.promise);
      render(<Review target={TARGET} />);
      await screen.findByRole("button", { name: "AI Review" });
      await menu("ai-review");
      expect(ensureAi).not.toHaveBeenCalled();
      await act(async () => {
        files.resolve(FILES);
        await Promise.resolve();
      });
      vi.mocked(aiReview).mockReturnValue(deferred<AiReview>().promise);
      await userEvent.click(button("AI Review"));
      await waitFor(() => {
        expect(button("AI Review").hasAttribute("disabled")).toBe(true);
      });
      expect(h.overview!.reviewing).toBe(true);
    });

    it("says what's missing rather than reviewing when the AI isn't ready", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      vi.mocked(ensureAi).mockResolvedValue(false);
      h.aiProblem = { title: "Sign in to Claude", message: "" };
      await openReview();
      await userEvent.click(button("AI Review"));
      expect(aiReview).not.toHaveBeenCalled();
    });

    it.each([
      ["its words", "timed out", "timed out"],
      ["an error", new Error("No quota"), "No quota"],
      ["anything else", 42, "42"],
    ])("shows why the review failed: %s", async (_kind, why, said) => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      await openReview();
      vi.mocked(aiReview).mockRejectedValueOnce(why);
      await menu("ai-review");
      await waitFor(() => {
        expect(h.overview!.reviewError).toBe(said);
      });
    });

    it("reviews on its own once per head when asked to, and only when it can", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi({ review: { auto: true, prompt: "" } }));
      vi.mocked(aiProblem).mockResolvedValueOnce({ title: "No", message: "" });
      await openReview();
      expect(aiReview).not.toHaveBeenCalled();
    });

    it("reviews on its own when it can", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi({ review: { auto: true, prompt: "" } }));
      vi.mocked(aiReview).mockResolvedValue(aiReviewOf([]));
      await openReview();
      await waitFor(() => {
        expect(aiReview).toHaveBeenCalledTimes(1);
      });
    });

    it("fetches the project ahead for questions, quietly", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi({ project: true }));
      answer({ ai_prepare: fail("no disk") });
      await openReview();
      await waitFor(() => {
        expect(sent("ai_prepare")).toEqual([{ project: { repo: "acme/shop", number: 7, head: "head1" } }]);
      });
    });

    it("answers questions about lines, from the side they're on", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      vi.mocked(askAboutLines).mockResolvedValue({ text: "It adds", project: false });
      await openReview();
      const ask = diffs().onAsk!;
      await expect(ask("src/cart.ts", { start: 5, end: 2, side: "deletions" }, "Why?", [], "r1")).resolves.toEqual({
        text: "It adds",
        project: false,
      });
      expect(askAboutLines).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        FILES,
        "src/cart.ts",
        2,
        5,
        "deletions",
        "Why?",
        [],
        "r1",
      );
      await ask("src/cart.ts", { start: 1, end: 1, side: "deletions", endSide: "additions" }, "?", [], "r2");
      expect(vi.mocked(askAboutLines).mock.lastCall![6]).toBe("additions");
      await ask("src/cart.ts", { start: 1, end: 1 }, "?", [], "r3");
      expect(vi.mocked(askAboutLines).mock.lastCall![6]).toBe("additions");
      vi.mocked(ensureAi).mockResolvedValue(false);
      await expect(ask("src/cart.ts", { start: 1, end: 1 }, "?", [], "r4")).rejects.toThrow(/Claude/u);
    });

    it("has no questions or findings' author without an AI set up", async () => {
      await openReview();
      expect(diffs().onAsk).toBeNull();
      expect(diffs().findingsBy).toBe("AI");
      act(() => {
        diffs().onDismissFinding(finding("src/cart.ts", 1));
      });
      await menu("ai-review");
      expect(ensureAi).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "AI Review" })).toBeNull();
    });
  });

  describe("actions", () => {
    it("runs your actions, reloading after one that worked", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ author: null }));
      vi.mocked(loadConfig).mockResolvedValue(
        config({ actions: [{ id: "a", name: "Ship", confirm: false, steps: [], choices: [] }] }),
      );
      await openReview();
      await waitFor(() => {
        expect(h.onResult).not.toBeNull();
      });
      vi.mocked(loadDetails).mockClear();
      act(() => {
        h.onResult!("Shipped", true);
      });
      expect(screen.getByRole("status").textContent).toBe("Shipped");
      await waitFor(() => {
        expect(loadDetails).toHaveBeenCalled();
      });
      expect(sent("refresh")).toContainEqual({ force: true });
      vi.mocked(loadDetails).mockClear();
      act(() => {
        h.onResult!("Didn't ship", false);
      });
      expect(loadDetails).not.toHaveBeenCalled();
      await userEvent.click(button("Actions"));
    });

    it("marks a draft ready for review", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ isDraft: true }));
      await openReview();
      await userEvent.click(button("Ready for Review"));
      expect(h.pull.actions.ready).toHaveBeenCalled();
    });

    it("can't mark it ready again while that's on its way", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ isDraft: true }));
      h.pull = h.make.pull({ busy: "ready" });
      await openReview();
      expect(button("Ready for Review").hasAttribute("disabled")).toBe(true);
    });

    it("offers merging to anyone who may, its details in the Overview", async () => {
      h.pull = h.make.pull({ view: { canUpdateBranch: true } });
      await openReview();
      await userEvent.click(tab("Diff"));
      await userEvent.click(button(/Merge/u));
      await userEvent.click(button("Merge details"));
      expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
      await menu("merge");
      expect(screen.getByRole("button", { name: "Merge details" })).toBeTruthy();
    });

    it("has no capsule of actions with nothing to put in it", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ state: "MERGED", isDraft: true }));
      await openReview();
      expect(screen.queryByRole("button", { name: /Merge/u })).toBeNull();
      expect(screen.queryByRole("button", { name: /Submit/u })).toBeNull();
    });

    it("opens the pull request on GitHub and shows the shortcuts from the More menu", async () => {
      await openReview();
      await userEvent.click(button("More"));
      await userEvent.click(screen.getByRole("menuitem", { name: "Open on GitHub" }));
      expect(sent("open_url")).toEqual([{ url: "https://github.com/acme/shop/pull/7" }]);
      await userEvent.click(button("More"));
      await userEvent.click(screen.getByRole("menuitem", { name: "Keyboard Shortcuts" }));
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("leaves the review when you confirm it", async () => {
      vi.mocked(leaveReview).mockImplementation(() => Promise.resolve());
      await openReview();
      confirmed = false;
      await userEvent.click(button("More"));
      await userEvent.click(screen.getByRole("menuitem", { name: "Leave This Review…" }));
      expect(leaveReview).not.toHaveBeenCalled();
      confirmed = true;
      await menu("leave");
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("You left the review");
      });
      expect(leaveReview).toHaveBeenCalledWith(expect.objectContaining({ number: 7 }), "me", ["acme/web"]);
      // Off the review queues at once, not at the next refresh.
      expect(sent("reviewed")).toEqual([{ prId: "PR_7" }]);
      vi.mocked(leaveReview).mockRejectedValueOnce(new Error("Not requested"));
      await menu("leave");
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Not requested");
      });
      vi.mocked(leaveReview).mockRejectedValueOnce("nope");
      await menu("leave");
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("nope");
      });
    });

    it("has nothing to leave on your own pull request, or before knowing who you are", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ viewerDidAuthor: true }));
      answer({ auth_status: () => ({ login: null }) });
      await openReview();
      await menu("leave");
      expect(sent("confirm")).toEqual([]);
    });
  });

  describe("submitting the review", () => {
    it("sends it with the kind and the words picked, and keeps the words until then", async () => {
      h.pending = h.make.pending([draft("d1", "src/cart.ts", 1), draft("d2", "src/cart.ts", 2)]);
      const view = await openReview();
      await userEvent.click(button(/Submit Review…/u));
      expect(screen.getByText("Sends 2 pending comments with it.")).toBeTruthy();
      await userEvent.type(screen.getByRole("textbox", { name: "Review comment" }), "Looks good");
      await userEvent.click(kinds().getByRole("button", { name: "Approve" }));
      // The kind that's on stays on.
      await userEvent.click(kinds().getByRole("button", { name: "Approve" }));
      view.unmount();
      await openReview();
      await userEvent.click(button(/Submit Review…/u));
      const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Review comment" });
      expect(field.value).toBe("Looks good");
      await userEvent.click(kinds().getByRole("button", { name: "Request Changes" }));
      expect(screen.getAllByRole("button", { name: "Request Changes" })).toHaveLength(2);
      vi.mocked(loadThreads).mockClear();
      fireEvent.keyDown(field, { key: "Enter", metaKey: true });
      await waitFor(() => {
        expect(h.pending.submit).toHaveBeenCalledWith(
          expect.objectContaining({ id: "PR_7" }),
          "REQUEST_CHANGES",
          "Looks good",
        );
      });
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Review sent");
      });
      expect(sent("reviewed")).toEqual([{ prId: "PR_7" }]);
      expect(loadThreads).toHaveBeenCalled();
      expect(localStorage.getItem("review-body:PR_7")).toBe('""');
    });

    it("says why GitHub didn't take it", async () => {
      await openReview();
      await menu("submit");
      h.pending.submit.mockRejectedValueOnce(new Error("Can't approve your own"));
      await userEvent.click(screen.getAllByRole("button", { name: "Comment" }).at(-1)!);
      expect((await screen.findByRole("alert")).textContent).toBe("Can't approve your own");
      h.pending.submit.mockRejectedValueOnce("offline");
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Review comment" }), { key: "Enter", ctrlKey: true });
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe("offline");
      });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Review comment" }), { key: "Enter" });
    });

    it("only comments on your own pull request", async () => {
      vi.mocked(loadDetails).mockResolvedValue(details({ viewerDidAuthor: true }));
      await openReview();
      await userEvent.click(button(/Submit Review…/u));
      expect(screen.getByText("It's your pull request: you can comment, not approve.")).toBeTruthy();
      expect(button("Approve").getAttribute("aria-disabled")).toBe("true");
    });

    it("throws the pending review away once you confirm, or says why it couldn't", async () => {
      h.pending = h.make.pending([draft("d1", "src/cart.ts", 1)]);
      await openReview();
      await userEvent.click(button(/Submit Review…/u));
      confirmed = false;
      await userEvent.click(button("Discard…"));
      expect(h.pending.discard).not.toHaveBeenCalled();
      confirmed = true;
      h.pending.discard.mockRejectedValueOnce(new Error("Gone already"));
      await userEvent.click(button("Discard…"));
      expect((await screen.findByRole("alert")).textContent).toBe("Gone already");
      h.pending.discard.mockRejectedValueOnce("offline");
      await userEvent.click(button("Discard…"));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe("offline");
      });
      await userEvent.click(button("Discard…"));
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Pending review discarded");
      });
    });
  });

  describe("the queue", () => {
    it("goes back and on to the next in the queue, from the toolbar and with ⌘[ and ⌘]", async () => {
      h.queue = { ...h.queue, next: visit(8, "Next one"), previous: visit(6, "Earlier one") };
      await openReview();
      expect(h.here).toEqual({
        pr: {
          id: "PR_7",
          number: 7,
          title: "Keep the promo code",
          repository: { nameWithOwner: "acme/shop" },
          author: { login: "ana" },
        },
        teams: ["acme/web"],
        queue: "q1",
      });
      await userEvent.click(button("Back to #6 Earlier one"));
      expect(h.queue.back).toHaveBeenCalledTimes(1);
      await userEvent.click(button("Next in Waiting on me: #8 Next one"));
      expect(h.queue.go).toHaveBeenCalledTimes(1);
      press("[", { metaKey: true });
      press("]", { metaKey: true });
      expect(h.queue.back).toHaveBeenCalledTimes(2);
      expect(h.queue.go).toHaveBeenCalledTimes(2);
    });

    it("goes up a stack first, in order, and to any of it from its menu", async () => {
      const part = (number: number, title: string, over: Partial<StackPull> = {}): StackPull => ({
        id: `PR_${number}`,
        number,
        title,
        author: { login: "ana" },
        isDraft: false,
        decision: null,
        ...over,
      });
      h.stack = {
        pulls: [
          part(5, "Bottom", { decision: "APPROVED" }),
          part(7, "Keep the promo code"),
          part(9, "Top", { isDraft: true }),
        ],
        at: 1,
      };
      h.queue = { ...h.queue, next: visit(8, "Next one") };
      await openReview();
      await userEvent.click(button("Next in the stack: #9 Top"));
      expect(h.queue.goTo).toHaveBeenCalledWith({
        pr: {
          id: "PR_9",
          number: 9,
          title: "Top",
          repository: { nameWithOwner: "acme/shop" },
          author: { login: "ana" },
        },
        teams: [],
        queue: "q1",
      });
      expect(h.queue.go).not.toHaveBeenCalled();
      await userEvent.click(button("2 of 3 in the stack"));
      expect(screen.getByRole("menuitemradio", { name: /#7 Keep the promo code/u }).getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(screen.getByRole("menuitemradio", { name: /#5 Bottom.*Approved/u })).toBeTruthy();
      expect(screen.getByRole("menuitemradio", { name: /#9 Top.*Draft/u })).toBeTruthy();
      await userEvent.click(screen.getByRole("menuitemradio", { name: /#5 Bottom/u }));
      expect(h.queue.goTo.mock.calls.at(-1)?.[0].pr.id).toBe("PR_5");
      // And from the stack under the overview's heading.
      act(() => {
        h.overview?.onPickStack?.(h.stack!.pulls[2]!);
      });
      expect(h.queue.goTo.mock.calls.at(-1)?.[0].pr.id).toBe("PR_9");
    });

    it("goes on with the queue from the top of a stack", async () => {
      const top: StackPull = {
        id: "PR_7",
        number: 7,
        title: "Keep the promo code",
        author: null,
        isDraft: false,
        decision: null,
      };
      h.stack = { pulls: [{ ...top, id: "PR_3", number: 3, decision: "CHANGES_REQUESTED" }, top], at: 1 };
      h.queue = { ...h.queue, next: visit(8, "Next one") };
      await openReview();
      await userEvent.click(button("Next in Waiting on me: #8 Next one"));
      expect(h.queue.go).toHaveBeenCalledTimes(1);
      expect(h.queue.goTo).not.toHaveBeenCalled();
      await userEvent.click(button("2 of 2 in the stack"));
      // The one already showing isn't gone to again.
      await userEvent.click(screen.getByRole("menuitemradio", { name: /#7 Keep the promo code/u }));
      expect(h.queue.goTo).not.toHaveBeenCalled();
      expect(screen.getByRole("menuitemradio", { name: /#3.*Changes requested/u })).toBeTruthy();
    });

    it("goes up a stack opened from outside any queue", async () => {
      const part = (number: number): StackPull => ({
        id: `PR_${number}`,
        number,
        title: `Part ${number}`,
        author: null,
        isDraft: false,
        decision: null,
      });
      h.stack = { pulls: [part(7), part(8)], at: 0 };
      await openReview({ ...TARGET, queue: undefined });
      await userEvent.click(button("Next in the stack: #8 Part 8"));
      expect(h.queue.goTo.mock.calls[0]?.[0].queue).toBeNull();
    });

    it("says the queue's done when there's no next", async () => {
      h.queue = {
        ...h.queue,
        previous: visit(6, "Earlier one"),
        go: vi.fn<(done?: boolean) => Promise<boolean>>(() => Promise.resolve(false)),
      };
      await openReview();
      await userEvent.click(button("Next"));
      expect(screen.getByRole("status").textContent).toBe("Nothing else waiting in Waiting on me");
    });

    it("calls it this queue when it has no name", async () => {
      h.queue = {
        ...h.queue,
        next: visit(8, "Next one"),
        go: vi.fn<(done?: boolean) => Promise<boolean>>(() => Promise.resolve(false)),
      };
      vi.mocked(loadDetails).mockResolvedValue(details({ author: null }));
      await openReview({ ...TARGET, queue: undefined });
      expect(h.here).toMatchObject({ queue: null, pr: { author: null } });
      expect(button("Back").hasAttribute("disabled")).toBe(true);
      press("]", { metaKey: true });
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Nothing else waiting in this queue");
      });
    });

    it("marks it done and goes on, from the toolbar and with e, saying so when it was the last", async () => {
      h.queue = {
        ...h.queue,
        next: visit(8, "Next one"),
        go: vi.fn<(done?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
      };
      await openReview();
      await userEvent.click(button("Mark Done"));
      expect(h.queue.go).toHaveBeenLastCalledWith(true);
      h.queue.go.mockResolvedValue(false);
      press("e");
      expect(h.queue.go).toHaveBeenCalledTimes(2);
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Done. Nothing else waiting in Waiting on me");
      });
      // Not as ⌥E (a typed character) or once typing.
      press("e", { altKey: true });
      expect(h.queue.go).toHaveBeenCalledTimes(2);
    });

    it("has no Mark Done when not opened from a queue, and calls an unknown queue this queue", async () => {
      h.queue = { ...h.queue, go: vi.fn<(done?: boolean) => Promise<boolean>>(() => Promise.resolve(false)) };
      const { unmount } = await openReview({ ...TARGET, queue: undefined });
      expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
      press("e");
      expect(h.queue.go).not.toHaveBeenCalled();
      unmount();
      await openReview({ ...TARGET, queue: "gone" });
      press("e");
      await waitFor(() => {
        expect(screen.getByRole("status").textContent).toBe("Done. Nothing else waiting in this queue");
      });
    });
  });

  describe("the menu bar", () => {
    it("is told which commands this pull request allows", async () => {
      h.pull = h.make.pull({ commits: { commits: [{}] } });
      await openReview();
      await waitFor(() => {
        expect(sent("menu_state").at(-1)).toMatchObject({
          items: { submit: true, leave: true, commits: true, close: true, "next-comment": false, "open-github": true },
        });
      });
    });

    it("carries out its commands", async () => {
      vi.mocked(loadConfig).mockResolvedValue(withAi());
      vi.mocked(aiReview).mockResolvedValue(aiReviewOf([]));
      const view = await openReview();
      await menu("find");
      await frames();
      expect(document.activeElement).toBe(screen.getByRole("searchbox"));
      await menu("overview");
      expect(tab("Overview").getAttribute("aria-selected")).toBe("true");
      await menu("diff");
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
      await menu("wrap");
      await menu("whitespace");
      expect(diffs().wrap).toBe(true);
      expect(diffs().whitespace).toBe(true);
      h.handle.listed.mockReturnValue(["src/cart.ts", "src/promo.ts"]);
      await menu("file-next");
      await frames();
      expect(h.handle.scrollToFile).toHaveBeenLastCalledWith("src/cart.ts");
      await menu("file-previous");
      await frames();
      expect(h.handle.scrollToFile).toHaveBeenLastCalledWith("src/promo.ts");
      h.handle.atTop.mockReturnValue({ path: "src/cart.ts", reached: true });
      await menu("toggle-viewed");
      expect(diffs().isViewed(A)).toBe(true);
      await menu("next-file");
      await frames();
      await menu("previous-comment");
      await menu("ai-review");
      await waitFor(() => {
        expect(aiReview).toHaveBeenCalled();
      });
      await menu("commits");
      await frames();
      expect(button("Changes").getAttribute("aria-expanded")).toBe("true");
      await menu("close");
      expect(h.pull.menu.close).toHaveBeenCalled();
      await menu("open-github");
      expect(sent("open_url")).toHaveLength(1);
      await menu("not-a-command");
      await menu("shortcuts");
      expect(screen.getByRole("dialog")).toBeTruthy();
      view.unmount();
      await act(() => wait(10));
    });

    it("has nothing to open before the pull request is known", async () => {
      vi.mocked(loadDetails).mockReturnValue(deferred<Details>().promise);
      render(<Review target={TARGET} />);
      await waitFor(() => {
        expect(sent("menu_state")).not.toHaveLength(0);
      });
      await menu("open-github");
      await userEvent.click(button("More"));
      await userEvent.click(screen.getByRole("menuitem", { name: "Open on GitHub" }));
      expect(sent("open_url")).toEqual([]);
    });

    it("doesn't mind when the menu bar can't be told", async () => {
      answer({ menu_state: fail("no menu") });
      await openReview();
      expect(screen.getByText("Overview of #7")).toBeTruthy();
    });
  });

  describe("new changes and conversations", () => {
    it("says when new changes were pushed, and brings them in on Update", async () => {
      h.newChanges = { head: "head2", at: 1 };
      await openReview();
      expect(screen.getByRole("status").textContent).toContain("New changes were pushed");
      expect(h.banner!.below).toBe(true);
      vi.mocked(loadDetails).mockClear();
      await userEvent.click(button("Update"));
      await waitFor(() => {
        expect(loadDetails).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(h.reload).toHaveBeenCalled();
      });
    });

    it("brings in other activity on its own", async () => {
      await openReview();
      vi.mocked(loadThreads).mockResolvedValue([thread("T9", "src/cart.ts", 2)]);
      vi.mocked(loadDetails).mockResolvedValue(details({ title: "Renamed" }));
      act(() => {
        h.onActivity!();
      });
      await screen.findByRole("heading", { level: 1, name: "Renamed" });
      expect(diffs().threads.get("src/cart.ts")).toHaveLength(1);
      expect(sent("refresh")).toContainEqual({ force: true });
    });

    it("answers, resolves and comments from the Overview, then catches up", async () => {
      vi.mocked(comment).mockResolvedValue("C_9");
      await openReview();
      const t = thread("T1", "src/cart.ts", 1);
      vi.mocked(loadThreads).mockClear();
      await act(() => h.overview!.onReply(t, "Done"));
      expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: "PR_7" }), t, "Done");
      await act(() => h.overview!.onResolve(t, true));
      expect(setResolved).toHaveBeenCalledWith(t, true);
      await expect(act(() => h.overview!.onComment("Thanks"))).resolves.toBe("C_9");
      expect(screen.getByRole("status").textContent).toBe("Comment posted");
      expect(loadThreads).toHaveBeenCalledTimes(3);
      expect(h.overview!.hasFile("src/cart.ts")).toBe(true);
      expect(h.overview!.hasFile("nope")).toBe(false);
    });

    it("answers, resolves and comments from the Diff", async () => {
      await openReview();
      const t = thread("T1", "src/cart.ts", 1);
      await act(() => diffs().onReply(t, "Done"));
      await act(() => diffs().onResolve(t, false));
      await act(() => diffs().onCommentNow({ path: "src/cart.ts", side: "additions", line: 2, body: "Now" }));
      expect(commentNow).toHaveBeenCalledWith(expect.objectContaining({ id: "PR_7" }), {
        path: "src/cart.ts",
        side: "additions",
        line: 2,
        body: "Now",
        key: "now",
      });
      expect(setResolved).toHaveBeenCalledWith(t, false);
      expect(diffs().onAddDraft).toBe(h.pending.add);
      expect(diffs().onEditDraft).toBe(h.pending.edit);
      expect(diffs().onRemoveDraft).toBe(h.pending.remove);
    });

    it("opens a range of commits from the Overview in the Diff", async () => {
      await openReview();
      act(() => {
        h.overview!.onOpenRange({ from: "a", to: "b" });
      });
      expect(h.pull.setRange).toHaveBeenCalledWith({ from: "a", to: "b" });
      expect(tab("Diff").getAttribute("aria-selected")).toBe("true");
      await frames();
      expect(h.handle.scrollToTop).toHaveBeenCalled();
    });
  });
});
