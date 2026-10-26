// The review window, where a pull request is reviewed, in two tabs: Overview (description,
// conversation, AI, reviewers, checks) and Diff (files and diffs with their conversations, a way to
// step through the comments, the review itself). Pending comments and what's been viewed are kept
// on this machine, so closing the window loses nothing.

import { ChevronDown, ChevronUp, Columns2, GitMerge, Loader2, MoreHorizontal, Rows2, Search, Sparkles, WrapText, X, Zap } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { keep, readKept } from "@/lib/kept";
import { askAboutLines, PROVIDERS, review as aiReview, type AiReview, type Finding } from "@/lib/ai";
import { bridge } from "@/lib/bridge";
import { inFilter, loadConfig, type Config } from "@/lib/config";
import { firstName } from "@/lib/copy";
import { comment, leaveReview, loadDetails, markReady, merge, type Details } from "@/lib/details";
import { createEstimator, learnFiles, reviewMinutes, useLearned } from "@/lib/estimate";
import { filtersFor, inAny, keptSelection, nextFile, nextFilterWithWork, stepFilter, toggled, totals } from "@/lib/filters";
import { commentNow, loadFiles, loadThreads, loadViewed, markViewed, reply, setResolved, submitReview, type Draft, type ReviewFile, type Thread, type ViewedState } from "@/lib/review";
import { useTheme } from "@/lib/theme";
import { ActionButtons, ActionMenuItems } from "@/shared/Actions";
import { cn } from "@/lib/utils";
import { isMac } from "@/lib/platform";
import { tabKeys } from "@/lib/keys";
import { SlidingPill } from "@/shared/SlidingPill";
import { useActiveTime } from "./activeTime";
import { Diffs, type DiffsHandle } from "./Diffs";
import { FilterBar, type Next } from "./FilterBar";
import { Overview } from "./Overview";

/** The pull request a window shows. `teams`: the ones its review was asked of on your behalf
 *  ("org/slug"), for leaving the review. */
export type Target = { id: string; repo: string; number: number; teams: string[] };

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// MARK: Kept on this machine

function stored<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Still works for this window.
  }
}
function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => stored(key, fallback));
  const set = useCallback(
    (next: T | ((v: T) => T)) =>
      setValue((v) => {
        const resolved = typeof next === "function" ? (next as (v: T) => T)(v) : next;
        store(key, resolved);
        return resolved;
      }),
    [key],
  );
  return [value, set] as const;
}

/** A file stays viewed until its changes do: keyed by a hash of its patch. */
const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
};
const without = (m: Record<string, string>, path: string) => (path in m ? Object.fromEntries(Object.entries(m).filter(([p]) => p !== path)) : m);

/** A file marked viewed after less than this wasn't reviewed, only ticked off: nothing to learn. */
const MIN_REVIEW_SECONDS = 2;

const useDark = (config: Config | null) => {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    // The theme may already be applied by the time this runs.
    setDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [config]);
  return dark;
};

type Event = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** The toolbar's items: borderless, 28pt, in capsules, as Tahoe's toolbars draw them. Toolbars are
 *  where macOS does light up an item under the pointer. */
const TOOL = "h-(--toolbar-item-h) rounded-full px-2.5 text-muted-foreground hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed) aria-expanded:text-foreground";
const TOOL_ICON = "size-(--toolbar-item-h) rounded-full px-0 text-muted-foreground hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed) aria-expanded:text-foreground";

const MERGE_LABEL = { merge: "Create Merge Commit", squash: "Squash and Merge", rebase: "Rebase and Merge" } as const;
const MERGE_HOW = { merge: "with a merge commit", squash: "as one squashed commit", rebase: "by rebasing its commits" } as const;

/** Submit Review…: the toolbar's one prominent action. Its popover keeps what was typed when it
 *  closes (and across closing the window), as a nonmodal popover should; sending clears it.
 *  `open`/`onOpenChange`: the menu bar's Submit Review… opens it too. */
function SubmitReview({ details, drafts, open, onOpenChange, onSubmitted }: { details: Details; drafts: Draft[]; open: boolean; onOpenChange: (open: boolean) => void; onSubmitted: () => void }) {
  const own = details.viewerDidAuthor;
  const setOpen = onOpenChange;
  const [event, setEvent] = useState<Event>("COMMENT");
  const [body, setBody] = usePersisted(`review-body:${details.id}`, "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitReview(details, event, body, drafts);
      setBody("");
      setOpen(false);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button className="h-(--toolbar-item-h) rounded-full px-3.5" />}>
        <span>
          Submit<span className="@max-[860px]:hidden"> Review</span>…
        </span>
        {drafts.length ? <Badge variant="secondary" className="ml-0.5 bg-white/25 text-primary-foreground">{drafts.length}</Badge> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3">
          <PopoverTitle>Finish Your Review</PopoverTitle>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment"
            aria-label="Review comment"
            className="resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <ToggleGroup value={[event]} onValueChange={(v: string[]) => v[0] && setEvent(v[0] as Event)} variant="outline" aria-label="Kind of review" className="w-full">
            <ToggleGroupItem value="COMMENT" className="flex-1">
              Comment
            </ToggleGroupItem>
            <ToggleGroupItem value="APPROVE" className="flex-1" disabled={own}>
              Approve
            </ToggleGroupItem>
            <ToggleGroupItem value="REQUEST_CHANGES" className="flex-1" disabled={own}>
              Request Changes
            </ToggleGroupItem>
          </ToggleGroup>
          {own ? <p className="text-callout text-muted-foreground">It's your pull request: you can comment, not approve.</p> : null}
          {drafts.length ? <p className="text-callout text-muted-foreground">Sends {drafts.length} pending {drafts.length === 1 ? "comment" : "comments"} with it.</p> : null}
          {error ? (
            <p className="text-callout text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {/* The default button, bottom right; ⌘↩ sends from the field. */}
          <Button className="self-end" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {event === "APPROVE" ? "Approve" : event === "REQUEST_CHANGES" ? "Request Changes" : "Comment"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Where a comment is, to step through them: a conversation, a pending comment, an AI comment. */
type Stop = { path: string; line: number; kind: "conversation" | "pending" | "ai" };

export function Review({ target }: { target: Target }) {
  const { id: prId, repo, number, teams } = target;
  const [config, setConfig] = useState<Config | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hideViewed, setHideViewed] = useState(false);
  const [diffStyle, setDiffStyle] = usePersisted<"split" | "unified">("diff-style", "split");
  const [wrap, setWrap] = usePersisted("diff-wrap", false);
  const [drafts, setDrafts] = usePersisted<Draft[]>(`drafts:${prId}`, []);
  const [viewed, setViewed] = usePersisted<Record<string, string>>(`viewed:${prId}`, {});
  const [tab, setTab] = usePersisted<"overview" | "diff">(`tab:${prId}`, "overview");
  const [stop, setStop] = useState(-1);
  // The parts being reviewed, remembered per repository: their files are what shows. (One filter's
  // id, from before they could be combined, reads as a list of one.)
  const [kept, setKept] = usePersisted<unknown>(`filter:${repo}`, []);
  // Viewed files opened anyway, to show a comment in one: they don't fold until marked again.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  // Viewed marks on their way to GitHub, by path: what GitHub said before they land doesn't undo them.
  const sending = useRef(new Map<string, number>());
  const learned = useLearned();
  const minutesOf = useMemo(() => createEstimator(learned), [learned]);
  // The AI review of this pull request's current head, kept until it changes.
  const [reviewed, setReviewed] = usePersisted<{ head: string; review: AiReview } | null>(`ai-review:${prId}`, null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  useTheme(config?.theme);
  const dark = useDark(config);
  const diffs = useRef<DiffsHandle>(null);
  const [me, setMe] = useState<string | null>(null);
  // Opened from the toolbar or the menu bar.
  const [submitting, setSubmitting] = useState(false);
  const [mergeMenu, setMergeMenu] = useState(false);
  // The file last picked in the sidebar: its row stays selected, as in a source list.
  const [picked, setPicked] = useState<string | null>(null);
  // The toolbar draws its edge only once something has scrolled under it.
  const [scrolled, setScrolled] = useState(false);
  const filterField = useRef<HTMLInputElement>(null);

  const ref = useMemo(() => ({ owner: repo.split("/")[0] ?? "", repo: repo.split("/")[1] ?? "", number }), [repo, number]);
  // All three at once: each needs only the pull request's address. What the panel fetched ahead of
  // a click comes back from memory (github.rs).
  // The copy kept from last time shows at once (kept.ts); what GitHub has now replaces it.
  const shownOnce = useRef(false);
  /** What you've viewed on github.com wins over what was kept here, but for marks still on their way. */
  const followGitHub = useCallback(
    (list: ReviewFile[], states: Map<string, ViewedState>) =>
      setViewed((m) => {
        const next = { ...m };
        for (const f of list) {
          const state = states.get(f.path);
          if (!state || sending.current.has(f.path)) continue;
          if (state === "VIEWED") next[f.path] = hash(f.patch);
          else delete next[f.path];
        }
        return next;
      }),
    [setViewed],
  );
  const load = useCallback(async () => {
    const fresh = { details: false, files: false, threads: false };
    // Beside the rest, never in its way: without it, what's kept here stands.
    const onGitHub = loadViewed(ref).catch(() => null);
    // Only for the first showing: a reload after you did something already has newer on screen.
    if (!shownOnce.current)
      void readKept(prId).then((kept) => {
        if (!kept || shownOnce.current) return;
        if (!fresh.details) setDetails(kept.details);
        if (!fresh.files) setFiles(kept.files);
        if (!fresh.threads) setThreads(kept.threads);
        performance.mark("kept");
      });
    try {
      const [d, f, t] = await Promise.all([
        loadDetails(repo, number).then((d) => ((fresh.details = true), setDetails(d), d)),
        loadFiles(ref).then((f) => ((fresh.files = true), setFiles(f), f)),
        loadThreads(ref).then((t) => ((fresh.threads = true), setThreads(t), t)),
      ]);
      shownOnce.current = true;
      setError(null);
      performance.mark("loaded");
      void keep(prId, { details: d, files: f, threads: t }, d.updatedAt);
      const states = await onGitHub;
      if (states) followGitHub(f, states);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [prId, repo, number, ref, followGitHub]);

  useEffect(() => {
    void loadConfig().then(setConfig);
    void bridge.authStatus().then((a) => setMe(a.login));
    void load();
  }, [load]);

  const ai = config?.ai.provider ? config : null;
  const current = reviewed && details && reviewed.head === details.headRefOid ? reviewed.review : null;
  const runReview = useCallback(async () => {
    if (!ai || !details || !files) return;
    setReviewing(details.headRefOid);
    setReviewError(null);
    try {
      setReviewed({ head: details.headRefOid, review: await aiReview(ai, details, files) });
    } catch (e) {
      setReviewError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(null);
    }
  }, [ai, details, files, setReviewed]);
  // On its own when the person asked for that, once per head commit.
  useEffect(() => {
    if (ai?.ai.review.auto && details && files && !current && !reviewing && !reviewError && details.state === "OPEN") void runReview();
  }, [ai, details, files, current, reviewing, reviewError, runReview]);
  const dropFinding = (finding: Finding) =>
    setReviewed((r) => (r ? { ...r, review: { ...r.review, findings: r.review.findings.filter((f) => f !== finding && !(f.path === finding.path && f.line === finding.line && f.body === finding.body)) } } : r));

  const say = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3500);
  };
  // The panel's lists catch up right away.
  const changed = useCallback(async () => {
    void bridge.refresh(true);
    const [t, d] = await Promise.all([loadThreads(ref), loadDetails(repo, number)]);
    setThreads(t);
    setDetails(d);
  }, [ref, repo, number]);

  const isViewed = useCallback((f: ReviewFile) => viewed[f.path] === hash(f.patch), [viewed]);
  // The filters for everywhere and this repository's own; the chosen ones that have files here. The
  // kept choice stays as it is, so another pull request in the repository gets the full set.
  const repoFilters = useMemo(() => filtersFor(config?.filters ?? [], repo), [config, repo]);
  const chosen = useMemo(() => {
    const ids = keptSelection(kept);
    return repoFilters.filter((f) => ids.includes(f.id) && (!files || files.some((x) => inFilter(f, x.path))));
  }, [kept, repoFilters, files]);
  const chosenIds = useMemo(() => chosen.map((f) => f.id), [chosen]);
  const inPart = useMemo(() => (files ?? []).filter((f) => inAny(chosen, f.path)), [files, chosen]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return inPart.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!hideViewed || viewed[f.path] !== hash(f.patch) || opened.has(f.path)));
  }, [inPart, filter, hideViewed, viewed, opened]);
  const viewedCount = inPart.filter(isViewed).length;
  const shown = useMemo(() => totals(inPart, isViewed, minutesOf), [inPart, isViewed, minutesOf]);
  const next = useMemo<Next>(() => {
    const left = visible.filter((f) => !isViewed(f)).length;
    return { left, nextFilter: chosen.length && !left ? nextFilterWithWork(files ?? [], repoFilters, chosenIds, isViewed) : undefined };
  }, [visible, isViewed, chosen, chosenIds, files, repoFilters]);

  const choose = useCallback(
    (ids: string[]) => {
      setKept(ids);
      // Another part starts at its top, not wherever the last one was scrolled to.
      requestAnimationFrame(() => diffs.current?.scrollToTop());
    },
    [setKept],
  );
  // Next and previous filter stop only at filters with files here.
  const stepPart = (by: 1 | -1) => choose(stepFilter(repoFilters.filter((f) => files?.some((x) => inFilter(f, x.path))).map((f) => f.id), chosenIds, by));
  /** The next file left to review, after the one at the top of the screen; with none left in the
   *  chosen filters, the next filter that has some. */
  const goToNextFile = () => {
    setTab("diff");
    // Files GitHub sends no diff for aren't in the list to go to.
    const target = nextFile(
      visible.filter((f) => f.patch),
      isViewed,
      diffs.current?.atTop() ?? null,
    );
    if (target) requestAnimationFrame(() => diffs.current?.scrollToFile(target.path));
    else if (next.nextFilter) choose([next.nextFilter.id]);
  };

  // The time spent on each file showing, to learn the reader's pace from the files they mark viewed.
  const take = useActiveTime(() => diffs.current?.onScreen() ?? [], tab === "diff");
  /** Marks a file viewed or not, here at once and on github.com after; if GitHub refuses, it goes back. */
  const setFileViewed = (f: ReviewFile, v: boolean) => {
    const before = viewed[f.path];
    setViewed((m) => (v ? { ...m, [f.path]: hash(f.patch) } : without(m, f.path)));
    if (v) {
      setOpened((s) => (s.has(f.path) ? new Set([...s].filter((p) => p !== f.path)) : s));
      const seconds = take(f.path);
      if (seconds >= MIN_REVIEW_SECONDS) void learnFiles([{ path: f.path, expected: reviewMinutes(f.path, f), actual: seconds / 60 }]);
    }
    sending.current.set(f.path, (sending.current.get(f.path) ?? 0) + 1);
    void markViewed(prId, f.path, v)
      .catch(() => {
        setViewed((m) => (before ? { ...m, [f.path]: before } : without(m, f.path)));
        say(`Couldn't ${v ? "mark" : "unmark"} ${f.path.slice(f.path.lastIndexOf("/") + 1)} as viewed on GitHub`);
      })
      .finally(() => {
        const left = (sending.current.get(f.path) ?? 1) - 1;
        if (left) sending.current.set(f.path, left);
        else sending.current.delete(f.path);
      });
  };

  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) map.set(t.path, [...(map.get(t.path) ?? []), t]);
    return map;
  }, [threads]);

  // The comments to step through, in the order of the files: open conversations, your pending
  // comments, the AI's. Resolved conversations are done with.
  const stops = useMemo<Stop[]>(() => {
    const order = new Map((files ?? []).map((f, i) => [f.path, i]));
    const all: Stop[] = [
      ...threads.filter((t) => !t.resolved).map((t) => ({ path: t.path, line: t.line, kind: "conversation" as const })),
      ...drafts.map((d) => ({ path: d.path, line: d.line, kind: "pending" as const })),
      ...(current?.findings.filter((f) => f.inDiff).map((f) => ({ path: f.path, line: f.line, kind: "ai" as const })) ?? []),
    ];
    return all.filter((x) => order.has(x.path)).sort((a, b) => order.get(a.path)! - order.get(b.path)! || a.line - b.line);
  }, [files, threads, drafts, current]);

  /** Shows a file (at a line) in the Diff tab, bringing it into view if a filter, a search or its
   *  folding as viewed hides it. */
  const jump = useCallback(
    (path: string, line: number | null) => {
      setTab("diff");
      setPicked(path);
      if (!inAny(chosen, path)) setKept([]);
      setFilter((q) => (q && !path.toLowerCase().includes(q.trim().toLowerCase()) ? "" : q));
      // Opened, not unmarked: it stays viewed, here and on GitHub.
      setOpened((s) => (s.has(path) ? s : new Set([...s, path])));
      // After the tab and the list have drawn.
      requestAnimationFrame(() => requestAnimationFrame(() => (line ? diffs.current?.scrollToLine(path, line) : diffs.current?.scrollToFile(path))));
    },
    [chosen, setKept, setTab],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (!stops.length) return;
      const next = (stop + by + stops.length) % stops.length;
      setStop(next);
      jump(stops[next]!.path, stops[next]!.line);
    },
    [stop, stops, jump],
  );
  // n and p step through the comments, like a reader's next and previous. The filters' shortcuts are
  // Focus Diff's own (⌥⇧. and ⌥⇧, for next and previous filter, ⌥⇧0 for all files, ⌥⇧J for the next
  // file to review), read by key position, since ⌥ changes the character typed.
  const filterKeys = useRef({ stepPart, choose, goToNextFile });
  useLayoutEffect(() => {
    filterKeys.current = { stepPart, choose, goToNextFile };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.shiftKey) {
        const keys = filterKeys.current;
        const action = { Period: () => keys.stepPart(1), Comma: () => keys.stepPart(-1), Digit0: () => keys.choose([]), KeyJ: keys.goToNextFile }[e.code];
        if (!action || !files) return;
        e.preventDefault();
        setTab("diff");
        action();
        return;
      }
      if (tab !== "diff" || e.altKey) return;
      if (e.key === "n" || e.key === "p") {
        e.preventDefault();
        step(e.key === "n" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, step, files, setTab]);

  const actionResult = (message: string, ok: boolean) => {
    say(message);
    if (ok) {
      void bridge.refresh(true);
      void load();
    }
  };
  const canMerge = details && details.viewerDidAuthor && details.state === "OPEN" && !details.isDraft && details.mergeable === "MERGEABLE" && details.mergeMethods.length > 0;
  const canLeave = Boolean(details && me && !details.viewerDidAuthor && details.state === "OPEN");
  /** Merging can't be undone: a native alert on this window asks first, naming how. */
  const mergeWith = async (method: Details["mergeMethods"][number]) => {
    if (!details) return;
    const ok = await bridge.confirm(`Merge pull request #${details.number}?`, `“${details.title}” goes into ${details.baseRefName} ${MERGE_HOW[method]}. This can't be undone.`, MERGE_LABEL[method]);
    if (!ok) return;
    void merge(details, method)
      .then(() => {
        say("Merged");
        void bridge.refresh(true);
        void load();
      })
      .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
  };
  const leave = async () => {
    if (!details || !me) return;
    if (!(await bridge.confirm(`Leave the review of #${details.number}?`, "You won't be asked to review it any more, and it leaves your queue.", "Leave Review"))) return;
    void leaveReview(details, me, teams)
      .then(() => {
        say("You left the review");
        void bridge.refresh(true);
      })
      .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
  };

  // The menu bar's review commands (src-tauri/src/menu.rs) come here when this window is in front;
  // it's told which of them this pull request allows, so the others are dimmed.
  const menuActions = useRef<Record<string, () => void>>({});
  useLayoutEffect(() => {
    menuActions.current = {
      find: () => {
        setTab("diff");
        requestAnimationFrame(() => filterField.current?.focus());
      },
      overview: () => setTab("overview"),
      diff: () => setTab("diff"),
      wrap: () => setWrap(!wrap),
      "next-file": goToNextFile,
      "next-comment": () => step(1),
      "previous-comment": () => step(-1),
      "ai-review": () => void runReview(),
      submit: () => setSubmitting(true),
      merge: () => setMergeMenu(true),
      "open-github": () => details && void bridge.openUrl(details.url),
      leave: () => void leave(),
    };
  });
  useEffect(() => {
    const off = bridge.on<string>("menu", (id) => menuActions.current[id]?.());
    return () => void off.then((f) => f());
  }, []);
  const isOpen = details?.state === "OPEN";
  const allowed = {
    "next-file": Boolean(files?.length),
    "next-comment": stops.length > 0,
    "previous-comment": stops.length > 0,
    "ai-review": Boolean(ai && details && files && !reviewing),
    submit: isOpen,
    merge: Boolean(canMerge),
    "open-github": Boolean(details),
    leave: canLeave,
  };
  const allowedKey = JSON.stringify(allowed);
  useEffect(() => {
    void bridge.menuState(JSON.parse(allowedKey) as Record<string, boolean>).catch(() => {});
  }, [allowedKey]);

  if (error && !details) {
    return (
      <div className="grid h-screen place-items-center p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-body text-destructive" role="alert">
            {error}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* One toolbar, as in Mail or Xcode. The view switch sits right after the traffic lights so it
          never moves; the title takes what's left and gives way first; the Diff's own controls open
          in beside the actions when the Diff is showing (the title making room for them, never the
          buttons). As the window narrows the branch line goes first, then the actions fold into a
          menu, then labels turn into icons. The bar is a size container so this follows its width. */}
      <header data-tauri-drag-region className={cn("@container relative z-10 flex shrink-0 items-center gap-2 bg-background pr-2.5 transition-shadow duration-(--duration)", isMac ? "h-(--toolbar-h) pl-(--traffic-lights-inset)" : "h-11 pl-2", scrolled && "shadow-[0_1px_0_var(--separator)]")}>
        {/* The view switch: a capsule with a neutral knob, concentric with the toolbar, as Finder's. */}
        <div role="tablist" onKeyDown={tabKeys} aria-label="View" className="relative isolate flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill p-0.5">
          <SlidingPill selected={tab} className="rounded-full bg-(--toolbar-segment-bg) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)]" />
          {(
            [
              ["overview", "Overview", details?.entries.length],
              ["diff", "Diff", files?.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              tabIndex={tab === value ? 0 : -1}
              id={`tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`panel-${value}`}
              data-pill={value}
              onClick={() => setTab(value)}
              className="flex h-6 cursor-default items-center gap-1.5 rounded-full px-3 text-body text-foreground outline-none focus-ring"
            >
              {label}
              {/* Its room kept while loading, so the switch doesn't grow when the count arrives. */}
              <span className="min-w-3.5 text-center text-subheadline text-muted-foreground tabular-nums @max-[860px]:hidden">
                {count === undefined ? <Skeleton className="h-3 w-3.5" /> : count || null}
              </span>
            </button>
          ))}
        </div>

        <div data-tauri-drag-region className="flex min-w-0 flex-1 flex-col justify-center gap-px pl-1">
          {details ? (
            <>
              <h1 data-tauri-drag-region className="truncate text-headline font-bold" title={details.title}>
                {details.title}
              </h1>
              {/* What just happened shows here for a moment, in place of the branch line, rather than
                  as a toast: a Mac window says it where you're looking. */}
              {notice ? (
                <p role="status" className="truncate text-subheadline text-foreground animate-in fade-in-0 duration-(--duration) motion-reduce:animate-none">
                  {notice}
                </p>
              ) : (
                <p data-tauri-drag-region className="truncate text-subheadline text-muted-foreground @max-[1180px]:hidden">
                  {repo} #{number} · {firstName(details.author)} · <span data-tauri-drag-region className="font-mono">{details.headRefName}</span>
                </p>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-3.5 w-64 max-w-full" />
              <Skeleton className="h-2.5 w-40 max-w-full @max-[1180px]:hidden" />
            </>
          )}
        </div>

        {/* The Diff's controls: drawn always, opened only in the Diff, so switching tabs moves no
            button; the title's room shrinks smoothly instead (at once with reduced motion). */}
        <div
          data-tauri-drag-region
          aria-hidden={tab !== "diff"}
          inert={tab !== "diff"}
          className={cn(
            "grid shrink-0 transition-[grid-template-columns,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            tab === "diff" ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
          )}
        >
          <div data-tauri-drag-region className="flex min-w-0 items-center gap-1 overflow-hidden px-1 py-1">
            {/* Stepping through the comments (n and p from the keyboard), one capsule. */}
            <div role="group" aria-label="Comments" className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL_ICON} aria-label="Previous comment" disabled={!stops.length} onClick={() => step(-1)} />}>
                  <ChevronUp />
                </TooltipTrigger>
                <TooltipContent>
                  Previous Comment <Kbd>p</Kbd>
                </TooltipContent>
              </Tooltip>
              <span className="px-0.5 text-center text-callout text-muted-foreground tabular-nums" aria-live="polite">
                <span className="inline-block min-w-[6.5rem] @max-[960px]:sr-only">
                  {stops.length ? (stop >= 0 ? `Comment ${stop + 1} of ${stops.length}` : `${stops.length} comment${stops.length === 1 ? "" : "s"}`) : "No open comments"}
                </span>
                <span aria-hidden className="hidden min-w-5 @max-[960px]:inline-block">
                  {stops.length ? (stop >= 0 ? `${stop + 1}/${stops.length}` : stops.length) : "0"}
                </span>
              </span>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL_ICON} aria-label="Next comment" disabled={!stops.length} onClick={() => step(1)} />}>
                  <ChevronDown />
                </TooltipTrigger>
                <TooltipContent>
                  Next Comment <Kbd>n</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
            {/* Layout and wrapping, one capsule of glyphs. */}
            <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              <ToggleGroup value={[diffStyle]} onValueChange={(v: string[]) => v[0] && setDiffStyle(v[0] as "split" | "unified")} spacing={0} aria-label="Layout" className="h-full rounded-full">
                {(
                  [
                    ["split", "Side by Side", Columns2],
                    ["unified", "One Column", Rows2],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <Tooltip key={value}>
                    <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-foreground")} />}>
                      <Icon />
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                ))}
              </ToggleGroup>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-primary")} aria-pressed={wrap} aria-label="Wrap long lines" onClick={() => setWrap(!wrap)} />}>
                  <WrapText />
                </TooltipTrigger>
                <TooltipContent>Wrap Long Lines</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* The person's own actions, AI, readiness and merging: one capsule of labelled items. The
              actions fold into a pull-down menu as the window narrows. */}
          {(config?.actions.length && details && me) || (ai && details) || canMerge || (details?.viewerDidAuthor && isOpen && details.isDraft) ? (
            <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              {config?.actions.length && details && me ? (
                <>
                  <div className="contents @max-[1100px]:hidden">
                    <ActionButtons
                      actions={config.actions}
                      className={TOOL}
                      pr={{ number: details.number, repo, title: details.title, url: details.url, author: details.author?.login ?? "", me }}
                      onResult={actionResult}
                    />
                  </div>
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "hidden @max-[1100px]:inline-flex")} aria-label="Actions" />} />}>
                        <Zap />
                      </TooltipTrigger>
                      <TooltipContent>Actions</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end">
                      <ActionMenuItems
                        actions={config.actions}
                        pr={{ number: details.number, repo, title: details.title, url: details.url, author: details.author?.login ?? "", me }}
                        onResult={actionResult}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
              {ai && details ? (
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" className={cn(TOOL, "@max-[960px]:w-(--toolbar-item-h) @max-[960px]:px-0")} onClick={() => void runReview()} disabled={Boolean(reviewing) || !files} />}>
                    {reviewing ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    <span className="@max-[960px]:sr-only">{current ? "Review Again" : "AI Review"}</span>
                  </TooltipTrigger>
                  <TooltipContent>{current ? "Review again with AI" : "Review with AI"}</TooltipContent>
                </Tooltip>
              ) : null}
              {details && details.viewerDidAuthor && isOpen && details.isDraft ? (
                <Button
                  variant="ghost"
                  className={TOOL}
                  onClick={() =>
                    void markReady(details)
                      .then(() => {
                        say("Ready for review");
                        void bridge.refresh(true);
                        void load();
                      })
                      .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
                  }
                >
                  Ready for Review
                </Button>
              ) : null}
              {canMerge ? (
                // A pull-down button: how to merge, then a native alert to confirm (it can't be undone).
                <DropdownMenu open={mergeMenu} onOpenChange={setMergeMenu}>
                  <DropdownMenuTrigger render={<Button variant="ghost" className={cn(TOOL, "gap-1 @max-[960px]:px-2")} />}>
                    <GitMerge /> <span className="@max-[960px]:sr-only">Merge</span>
                    <ChevronDown className="size-3 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Merge Pull Request</DropdownMenuLabel>
                    {details.mergeMethods.map((method) => (
                      <DropdownMenuItem key={method} onClick={() => void mergeWith(method)}>
                        {MERGE_LABEL[method]}…
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={TOOL_ICON} aria-label="More" />} />}>
                <MoreHorizontal />
              </TooltipTrigger>
              <TooltipContent>More</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => details && void bridge.openUrl(details.url)}>Open on GitHub</DropdownMenuItem>
              {canLeave ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void leave()}>Leave This Review…</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {details && isOpen ? (
            <SubmitReview
              details={details}
              drafts={drafts}
              open={submitting}
              onOpenChange={setSubmitting}
              onSubmitted={() => {
                setDrafts([]);
                say("Review sent");
                void changed();
              }}
            />
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col" onScrollCapture={(e) => setScrolled((e.target as HTMLElement).scrollTop > 0)}>
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"} className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
          {details ? (
            <Overview
              config={config}
              details={details}
              threads={threads}
              review={current}
              reviewing={Boolean(reviewing)}
              reviewError={reviewError}
              onJump={jump}
              onReply={async (thread, body) => {
                await reply(details, thread, body);
                await changed();
              }}
              onResolve={async (thread, resolved) => {
                await setResolved(thread, resolved);
                await changed();
              }}
              onComment={async (body) => {
                await comment(details, body);
                say("Comment posted");
                await changed();
              }}
            />
          ) : (
            // The Overview's own layout, empty: nothing moves when it fills in.
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true" aria-label="Loading">
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-4/5" />
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
          )}
        </div>

        <div role="tabpanel" id="panel-diff" aria-labelledby="tab-diff" hidden={tab !== "diff"} className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r" aria-label="Files">
            <div className="flex flex-col gap-2 border-b p-3">
              {/* A search field: a capsule, the magnifier inside, a clear button once there's text. */}
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  ref={filterField}
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    requestAnimationFrame(() => diffs.current?.scrollToTop());
                  }}
                  onKeyDown={(e) => e.key === "Escape" && filter && (e.preventDefault(), setFilter(""))}
                  placeholder="Filter Files"
                  aria-label="Filter files"
                  className="rounded-full pr-6 pl-7 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                />
                {filter ? (
                  <button type="button" aria-label="Clear" onClick={() => setFilter("")} className="absolute top-1/2 right-1.5 grid size-3.5 -translate-y-1/2 cursor-default place-items-center rounded-full bg-muted-foreground/60 text-background outline-none focus-ring">
                    <X className="size-2.5" strokeWidth={3} aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-subheadline text-muted-foreground">
                <Progress value={inPart.length ? (viewedCount / inPart.length) * 100 : 0} className="flex-1" aria-label="Files viewed" />
                <span className="tabular-nums">
                  {viewedCount}/{inPart.length} viewed
                </span>
              </div>
              <label className="flex items-center gap-1.5 text-body">
                <Checkbox checked={hideViewed} onCheckedChange={setHideViewed} className="size-3.5" /> Hide Viewed Files
              </label>
            </div>
            {/* A source list: no highlight under the pointer; the picked file's row in the accent while
                the list has focus, gray otherwise (and in a window that isn't in front). */}
            <div className="group/list min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <ul className="flex flex-col px-2.5 py-1.5" aria-busy={!files}>
                {!files
                  ? [0, 1, 2, 3, 4, 5].map((i) => (
                      <li key={i} className="flex h-(--row-h-sm) items-center gap-2 px-2">
                        <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${70 - i * 6}%` }} />
                        <Skeleton className="h-3 w-10" />
                      </li>
                    ))
                  : null}
                {visible.map((f) => {
                  const slash = f.path.lastIndexOf("/");
                  const comments = threadsByPath.get(f.path)?.filter((t) => !t.resolved).length ?? 0;
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        data-selected={picked === f.path}
                        aria-current={picked === f.path || undefined}
                        className={cn(
                          "flex h-(--row-h-sm) w-full cursor-default items-center gap-2 rounded-(--radius-row) px-2 text-left text-callout outline-none focus-ring-inset",
                          "data-[selected=true]:bg-(--selection-bg-inactive) group-focus-within/list:data-[selected=true]:bg-(--selection-bg) group-focus-within/list:data-[selected=true]:text-(--selection-fg) group-focus-within/list:data-[selected=true]:**:text-(--selection-fg) group-focus-within/list:data-[selected=true]:focus-visible:outline-none",
                          isViewed(f) && "text-muted-foreground",
                        )}
                        onClick={() => {
                          setPicked(f.path);
                          diffs.current?.scrollToFile(f.path);
                        }}
                        title={f.path}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">
                          <span className="text-muted-foreground">{f.path.slice(0, slash + 1)}</span>
                          {f.path.slice(slash + 1)}
                        </span>
                        {comments ? <span className="text-subheadline text-unread tabular-nums" aria-label={`${comments} open conversations`}>{comments}</span> : null}
                        <span className="shrink-0 font-mono text-subheadline tabular-nums">
                          <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          <div className="relative min-w-0 flex-1 bg-muted/30">
            {files ? (
              visible.length ? (
                <Diffs
                  ref={diffs}
                  files={visible}
                  threads={threadsByPath}
                  drafts={drafts}
                  findings={current?.findings ?? []}
                  findingsBy={ai ? PROVIDERS[ai.ai.provider!].name : "AI"}
                  onAcceptFinding={(f) => {
                    setDrafts((list) => [...list, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, path: f.path, side: "additions", line: f.line, body: f.body }]);
                    dropFinding(f);
                  }}
                  onDismissFinding={dropFinding}
                  onAsk={
                    ai && details && files
                      ? (path, range, question, earlier) =>
                          askAboutLines(ai, details, files, path, Math.min(range.start, range.end), Math.max(range.start, range.end), range.endSide ?? range.side ?? "additions", question, earlier)
                      : null
                  }
                  isViewed={isViewed}
                  diffStyle={diffStyle}
                  wrap={wrap}
                  dark={dark}
                  opened={opened}
                  onViewed={setFileViewed}
                  onAddDraft={(draft) => setDrafts((list) => [...list, { ...draft, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }])}
                  onEditDraft={(key, body) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, body } : d)))}
                  onRemoveDraft={(key) => setDrafts((list) => list.filter((d) => d.key !== key))}
                  onCommentNow={async (draft) => {
                    if (!details) return;
                    await commentNow(details, { ...draft, key: "now" });
                    say("Comment posted");
                    await changed();
                  }}
                  onReply={async (thread, body) => {
                    if (!details) return;
                    await reply(details, thread, body);
                    await changed();
                  }}
                  onResolve={async (thread, resolved) => {
                    await setResolved(thread, resolved);
                    await changed();
                  }}
                />
              ) : (
                <p className="p-10 text-center text-body text-muted-foreground">{chosen.length && !inPart.length ? `No files in ${chosen.map((f) => f.name).join(" + ")}.` : "No files match."}</p>
              )
            ) : (
              <div className="flex flex-col gap-3 p-3" aria-busy="true" aria-label="Loading files">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            )}
            {files?.length ? (
              <FilterBar
                files={files}
                filters={repoFilters}
                chosen={chosenIds}
                shown={shown}
                next={next}
                isViewed={isViewed}
                minutesOf={minutesOf}
                learned={learned}
                onToggle={(id) => choose(toggled(chosenIds, id))}
                onNextFile={goToNextFile}
              />
            ) : null}
          </div>
        </div>
      </main>

    </div>
  );
}
