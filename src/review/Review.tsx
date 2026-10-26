// The review window, where a pull request is reviewed, in two tabs: Overview (description,
// conversation, AI, reviewers, checks) and Diff (files and diffs with their conversations, a way to
// step through the comments, the review itself). Pending comments and what's been viewed are kept
// on this machine, so closing the window loses nothing.

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns2, GitCommitHorizontal, GitMerge, Loader2, MoreHorizontal, Pilcrow, RefreshCw, Rows2, Search, Sparkles, WrapText, X, Zap } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { keep, readKept, type Kept } from "@/lib/kept";
import { askAboutLines, PROVIDERS, review as aiReview, type AiReview, type Finding } from "@/lib/ai";
import { aiProblem, ensureAi, useAiProblem } from "@/lib/aiReady";
import { bridge } from "@/lib/bridge";
import { inFilter, loadConfig, type Config } from "@/lib/config";
import { firstName } from "@/lib/copy";
import { i18n, useT } from "@/lib/i18n";
import { comment, leaveReview, loadDetails, type Details } from "@/lib/details";
import { useRangeFiles } from "@/lib/commits";
import { createEstimator, learnFiles, reviewMinutes, useLearned } from "@/lib/estimate";
import { filtersFor, inAny, keptSelection, nextFile, nextFilterWithWork, stepFilter, toggled, totals } from "@/lib/filters";
import { commentNow, loadFiles, loadThreads, loadViewed, reply, setResolved, type Draft, type ReviewFile, type Thread, type ViewedState } from "@/lib/review";
import { useTheme } from "@/lib/theme";
import { mergeBase, type Source } from "@/lib/contents";
import { patchHash } from "@/lib/hashes";
import { stepFile } from "@/lib/navigate";
import { inTreeOrder } from "@/lib/tree";
import { ActionButtons, ActionMenuItems } from "@/shared/Actions";
import { cn } from "@/lib/utils";
import { isMac } from "@/lib/platform";
import { tabKeys } from "@/lib/keys";
import { SlidingPill } from "@/shared/SlidingPill";
import { useActiveTime } from "./activeTime";
import { ConversationProvider, useConversation } from "./conversation";
import { published, usePending } from "./pending";
import { SuggestionBatch } from "./Suggestion";
import { Diffs, type DiffsHandle, type LinkTarget } from "./Diffs";
import { FileTree } from "./FileTree";
import { FilterBar, type Next } from "./FilterBar";
import { Overview } from "./Overview";
import { Shortcuts } from "./Shortcuts";
import { RangeBanner, RangePicker } from "./Commits";
import { MergeMenuItems, PullMenuItems } from "./PullMenus";
import { useNextInQueue, type Visit } from "./next";
import { usePull } from "./usePull";
import { useNewChanges } from "./newChanges";

/** The pull request a window shows. `teams`: the ones its review was asked of on your behalf
 *  ("org/slug"), for leaving the review. */
/** `queue`: the one it was opened from, whose next pull request the toolbar offers. */
export type Target = { id: string; repo: string; number: number; teams: string[]; queue?: string | null };

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

/** Submit Review…: the toolbar's one prominent action. Its popover keeps what was typed when it
 *  closes (and across closing the window), as a nonmodal popover should; sending clears it.
 *  `open`/`onOpenChange`: the menu bar's Submit Review… opens it too. */
function SubmitReview({
  details,
  drafts,
  open,
  onOpenChange,
  onSubmit,
  onDiscard,
  onSubmitted,
}: {
  details: Details;
  drafts: Draft[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends the review with your pending comments (lib/pending.ts); throws to say why not. */
  onSubmit: (event: Event, body: string) => Promise<void>;
  /** Throws your pending review away, here and on GitHub. */
  onDiscard: () => Promise<void>;
  onSubmitted: () => void;
}) {
  const t = useT();
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
      await onSubmit(event, body);
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
        <span className="@max-[860px]:hidden">{t("review.submit")}</span>
        <span className="hidden @max-[860px]:inline">{t("review.submitShort")}</span>
        {drafts.length ? <Badge variant="secondary" className="ml-0.5 bg-white/25 text-primary-foreground">{drafts.length}</Badge> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3">
          <PopoverTitle>{t("review.finishTitle")}</PopoverTitle>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("review.leaveComment")}
            aria-label={t("review.reviewComment")}
            className="resize-y"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <ToggleGroup value={[event]} onValueChange={(v: string[]) => v[0] && setEvent(v[0] as Event)} variant="outline" aria-label={t("review.kindOfReview")} className="w-full">
            <ToggleGroupItem value="COMMENT" className="flex-1">
              {t("review.comment")}
            </ToggleGroupItem>
            <ToggleGroupItem value="APPROVE" className="flex-1" disabled={own}>
              {t("review.approve")}
            </ToggleGroupItem>
            <ToggleGroupItem value="REQUEST_CHANGES" className="flex-1" disabled={own}>
              {t("review.requestChanges")}
            </ToggleGroupItem>
          </ToggleGroup>
          {own ? <p className="text-callout text-muted-foreground">{t("review.ownPull")}</p> : null}
          {drafts.length ? <p className="text-callout text-muted-foreground">{t("review.sendsPending", { count: drafts.length })}</p> : null}
          {error ? (
            <p className="text-callout text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {/* The default button, bottom right; ⌘↩ sends from the field. Throwing the pending review
              away can't be undone: a native alert asks first. */}
          <div className="flex items-center justify-end gap-2">
            {drafts.length ? (
              <Button
                variant="destructive"
                className="mr-auto"
                disabled={busy}
                onClick={async () => {
                  const t = i18n();
                  if (!(await bridge.confirm(t("review.discardConfirm"), t("review.discardConfirmMessage", { count: drafts.length }), t("review.discardConfirmButton")))) return;
                  setBusy(true);
                  setError(null);
                  try {
                    await onDiscard();
                    setOpen(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("review.discardReview")}
              </Button>
            ) : null}
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {event === "APPROVE" ? t("review.approve") : event === "REQUEST_CHANGES" ? t("review.requestChanges") : t("review.comment")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Where a comment is, to step through them: a conversation, a pending comment, an AI comment. */
type Stop = { path: string; line: number; side: Thread["side"]; kind: "conversation" | "pending" | "ai"; thread?: Thread };

export function Review({ target }: { target: Target }) {
  const t = useT();
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
  // Whitespace changes hidden, as GitHub's ?w=1; kept like the layout and wrapping.
  const [whitespace, setWhitespace] = usePersisted("diff-whitespace", false);
  const [shortcuts, setShortcuts] = useState(false);
  const [viewed, setViewed] = usePersisted<Record<string, string>>(`viewed:${prId}`, {});
  const [tab, setTab] = usePersisted<"overview" | "diff">(`tab:${prId}`, "overview");
  const [stop, setStop] = useState(-1);
  // The parts being reviewed, remembered per repository: their files are what shows. (One filter's
  // id, from before they could be combined, reads as a list of one.)
  const [kept, setKept] = usePersisted<unknown>(`filter:${repo}`, []);
  // Viewed files opened anyway, to show a comment in one: they don't fold until marked again.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const learned = useLearned();
  // This pull request, for coming back to it from the next.
  const here = useMemo<Visit | null>(
    () => (details ? { pr: { id: prId, number, title: details.title, repository: { nameWithOwner: repo }, author: details.author ? { login: details.author.login } : null }, teams, queue: target.queue ?? null } : null),
    [details, prId, number, repo, teams, target.queue],
  );
  const { next: nextPull, go: goNext, previous, back: goBack } = useNextInQueue(target.queue, prId, here);
  const queueName = config?.queues.find((q) => q.id === target.queue)?.name ?? "";
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
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
  // The title centred on the window, as a Mac window's is, while it has room between the two ends;
  // when it hasn't, it takes what's between them instead.
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const [titleBox, setTitleBox] = useState<{ left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const leading = leadingRef.current;
    const trailing = trailingRef.current;
    const bar = leading?.parentElement;
    if (!leading || !trailing || !bar) return;
    const GAP = 16;
    const place = () => {
      const width = bar.clientWidth;
      const left = leading.offsetLeft + leading.offsetWidth + GAP;
      const right = width - trailing.offsetLeft + GAP;
      const side = Math.max(left, right);
      setTitleBox(width - 2 * side >= 280 ? { left: side, right: side } : { left, right });
    };
    place();
    const observer = new ResizeObserver(place);
    for (const el of [bar, leading, trailing]) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const filterField = useRef<HTMLInputElement>(null);

  const ref = useMemo(() => ({ owner: repo.split("/")[0] ?? "", repo: repo.split("/")[1] ?? "", number }), [repo, number]);
  // Your pending review, on GitHub (pending.ts); the conversations without its comments.
  const pending = usePending(prId, ref, threads);
  const drafts = pending.drafts;
  const conversations = useMemo(() => published(threads), [threads]);
  // Both versions of the files (to expand context, show pictures, load large files) and links to
  // them, once the head commit is known.
  const head = details?.headRefOid;
  const source = useMemo<Source | null>(() => (head ? { repo, head, base: () => mergeBase(ref, head) } : null), [repo, ref, head]);
  const link = useMemo<LinkTarget | null>(() => (head ? { ...ref, head } : null), [ref, head]);
  // The copy kept from last time shows at once (kept.ts); what GitHub has now replaces it.
  const shownOnce = useRef(false);
  /** What you've viewed on github.com, for the files not marked here; what's marked here goes to GitHub. */
  const followGitHub = useCallback(
    (list: ReviewFile[], states: Map<string, ViewedState>, queued: Record<string, boolean>) =>
      setViewed((m) => {
        const next = { ...m };
        for (const f of list) {
          const state = states.get(f.path);
          const mine = m[f.path];
          if (!state || f.path in queued) continue;
          // Marked here (viewed, at these changes, or unmarked): the app's mark wins and goes to
          // GitHub if it says otherwise. Untouched here, or marked before the file changed: GitHub's.
          if (mine === "" || mine === patchHash(f)) {
            if ((state === "VIEWED") !== (mine !== "")) void bridge.queueViewed(prId, f.path, mine !== "");
          } else if (state === "VIEWED") next[f.path] = patchHash(f);
          else delete next[f.path];
        }
        return next;
      }),
    [setViewed, prId],
  );
  // What's on screen, to fetch only what changed since: the copy kept on disk for the first
  // showing, what was last loaded after that.
  const last = useRef<Kept | null>(null);
  const load = useCallback(async () => {
    // Beside the rest, never in its way: without it, what's kept here stands.
    const onGitHub = loadViewed(ref).catch(() => null);
    const asked = loadDetails(repo, number);
    try {
      // Only for the first showing: a reload after you did something already has newer on screen.
      let before = last.current;
      if (!shownOnce.current) {
        before = await readKept(prId);
        if (before && !last.current) {
          setDetails(before.details);
          setFiles(before.files);
          setThreads(before.threads);
          performance.mark("kept");
        }
      }
      let d: Details, f: ReviewFile[], t: Thread[];
      if (before) {
        // Shown already: ask for the details, then only what changed. The files change only with
        // the head commit (or another base branch); the conversations, with the pull request.
        d = await asked;
        setDetails(d);
        const sameFiles = before.details.headRefOid === d.headRefOid && before.details.baseRefName === d.baseRefName;
        [f, t] = await Promise.all([
          sameFiles ? before.files : loadFiles(ref, d.changedFiles).then((f) => (setFiles(f), f)),
          before.details.updatedAt === d.updatedAt ? before.threads : loadThreads(ref).then((t) => (setThreads(t), t)),
        ]);
      } else {
        // Nothing yet: all three at once, each needs only the pull request's address. What the
        // panel fetched ahead of a click comes back from memory (github.rs).
        [d, f, t] = await Promise.all([asked.then((d) => (setDetails(d), d)), loadFiles(ref).then((f) => (setFiles(f), f)), loadThreads(ref).then((t) => (setThreads(t), t))]);
      }
      shownOnce.current = true;
      last.current = { details: d, files: f, threads: t };
      setError(null);
      performance.mark("loaded");
      void keep(prId, last.current, d.updatedAt);
      const [states, queued] = await Promise.all([onGitHub, bridge.queuedViewed(prId).catch(() => ({}))]);
      if (states) followGitHub(f, states, queued);
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
  const aiProblemNow = useAiProblem(ai);
  // The pull request's code fetched as soon as it's known, so questions can read it straight away.
  const projectHead = ai?.ai.project && details?.state === "OPEN" ? details.headRefOid : null;
  useEffect(() => {
    if (projectHead && !aiProblemNow) void bridge.aiPrepare({ repo, number, head: projectHead }).catch(() => {});
  }, [projectHead, aiProblemNow, repo, number]);
  // Asked for: says what's missing when the AI can't answer. On its own: only when it can.
  const runReview = useCallback(async (asked = true) => {
    if (!ai || !details || !files) return;
    if (asked ? !(await ensureAi(ai)) : await aiProblem(ai)) return;
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
    if (ai?.ai.review.auto && details && files && !current && !reviewing && !reviewError && details.state === "OPEN") void runReview(false);
  }, [ai, details, files, current, reviewing, reviewError, runReview]);
  const dropFinding = (finding: Finding) =>
    setReviewed((r) => (r ? { ...r, review: { ...r.review, findings: r.review.findings.filter((f) => f !== finding && !(f.path === finding.path && f.line === finding.line && f.body === finding.body)) } } : r));

  const say = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 3500);
  };
  // The whole conversation, and what its comments can do wherever they're drawn (conversation.tsx).
  const talk = useConversation({ prId, ref, details, threads, setThreads, files, me, pending, say, reloadAll: () => void load() });
  const reloadConversation = talk.reload;
  // Merging, checks, commits, people and the rest around the pull request (usePull.ts); the range of
  // commits the diff shows, and its files when it isn't all of them.
  const pull = usePull({ prId, ref, details, setDetails, threads, say, reloadAll: () => void load() });
  const [rangeMenu, setRangeMenu] = useState(false);
  const ranged = useRangeFiles(ref, pull.range);
  const shownFiles = pull.range ? ranged.files : files;
  // Viewed marks belong to the pull request's version of a file, whichever range shows it.
  const pullFiles = useMemo(() => new Map((files ?? []).map((f) => [f.path, f])), [files]);
  const pullFileOf = useCallback((f: ReviewFile) => pullFiles.get(f.path) ?? f, [pullFiles]);
  const range = pull.range;
  // Conversations sit on the head's lines: an older version's lines aren't those.
  const olderRange = Boolean(range && details && range.to !== details.headRefOid);
  // The two versions the expanded lines come from: the range's ends when it's a range.
  const diffSource = useMemo<Source | null>(() => (range ? { repo, head: range.to, base: () => Promise.resolve(range.from) } : source), [range, repo, source]);

  // The panel's lists catch up right away.
  const changed = useCallback(async () => {
    void bridge.refresh(true);
    void reloadConversation();
    const [t, d] = await Promise.all([loadThreads(ref), loadDetails(repo, number)]);
    setThreads(t);
    setDetails(d);
    if (last.current) last.current = { ...last.current, details: d, threads: t };
  }, [ref, repo, number, reloadConversation]);

  // Pushed to while it's open: said, with a way to show it (the diff doesn't change under you).
  // Anything else new (comments, reviews, labels) comes in on its own.
  const newChanges = useNewChanges(repo, number, details?.headRefOid, details?.updatedAt, () => void changed());
  const [updating, setUpdating] = useState(false);
  const update = async () => {
    setUpdating(true);
    void bridge.refresh(true);
    await load();
    void reloadConversation();
    setUpdating(false);
  };

  const isViewed = useCallback((f: ReviewFile) => viewed[f.path] === patchHash(pullFileOf(f)), [viewed, pullFileOf]);
  // The filters for everywhere and this repository's own; the chosen ones that have files here. The
  // kept choice stays as it is, so another pull request in the repository gets the full set.
  const repoFilters = useMemo(() => filtersFor(config?.filters ?? [], repo), [config, repo]);
  const chosen = useMemo(() => {
    const ids = keptSelection(kept);
    return repoFilters.filter((f) => ids.includes(f.id) && (!files || files.some((x) => inFilter(f, x.path))));
  }, [kept, repoFilters, files]);
  const chosenIds = useMemo(() => chosen.map((f) => f.id), [chosen]);
  // In the sidebar's order (folders first), so the diff reads as the tree lists it.
  const ordered = useMemo(() => (shownFiles ? inTreeOrder(shownFiles) : []), [shownFiles]);
  const inPart = useMemo(() => ordered.filter((f) => inAny(chosen, f.path)), [ordered, chosen]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return inPart.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!hideViewed || !isViewed(f) || opened.has(f.path)));
  }, [inPart, filter, hideViewed, isViewed, opened]);
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

  /** j and k: the next or previous file in the list (files with a diff). */
  const stepToFile = (by: 1 | -1) => {
    const target = stepFile(diffs.current?.listed() ?? [], diffs.current?.atTop() ?? null, by);
    if (!target) return;
    setPicked(target);
    diffs.current?.scrollToFile(target);
  };
  /** v: the file at the top of the screen, marked viewed or not. */
  const toggleViewedAtTop = () => {
    const top = diffs.current?.atTop();
    const file = top && visible.find((f) => f.path === top.path);
    if (file) setFileViewed(file, !isViewed(file));
  };

  // The time spent on each file showing, to learn the reader's pace from the files they mark viewed.
  const take = useActiveTime(() => diffs.current?.onScreen() ?? [], tab === "diff");
  /** Marks a file viewed or not, here at once and on github.com after; if GitHub refuses, it goes back. */
  const setFileViewed = (f: ReviewFile, v: boolean) => {
    // Unmarked stays as "", so GitHub's older mark doesn't come back over it.
    setViewed((m) => ({ ...m, [f.path]: v ? patchHash(pullFileOf(f)) : "" }));
    if (v) {
      setOpened((s) => (s.has(f.path) ? new Set([...s].filter((p) => p !== f.path)) : s));
      const seconds = take(f.path);
      if (seconds >= MIN_REVIEW_SECONDS) void learnFiles([{ path: f.path, expected: reviewMinutes(f.path, f), actual: seconds / 60 }]);
    }
    // Rust keeps it until GitHub takes it (outbox.rs), so it's never undone here.
    void bridge.queueViewed(prId, f.path, v);
  };

  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of conversations) map.set(t.path, [...(map.get(t.path) ?? []), t]);
    return map;
  }, [conversations]);

  // The comments to step through, in the order of the files: open conversations, your pending
  // comments, the AI's. Resolved conversations are done with.
  const stops = useMemo<Stop[]>(() => {
    const order = new Map(ordered.map((f, i) => [f.path, i]));
    const all: Stop[] = [
      ...conversations.filter((t) => !t.resolved).map((t) => ({ path: t.path, line: t.line, side: t.side, kind: "conversation" as const, thread: t })),
      ...drafts.map((d) => ({ path: d.path, line: d.line, side: d.side, kind: "pending" as const })),
      ...(current?.findings.filter((f) => f.inDiff).map((f) => ({ path: f.path, line: f.line, side: "additions" as const, kind: "ai" as const })) ?? []),
    ];
    return all.filter((x) => order.has(x.path)).sort((a, b) => order.get(a.path)! - order.get(b.path)! || a.line - b.line);
  }, [ordered, conversations, drafts, current]);

  /** Shows a file (at a line) in the Diff tab, bringing it into view if a filter, a search or its
   *  folding as viewed hides it. */
  const jump = useCallback(
    (path: string, line: number | null, side?: Thread["side"], thread?: Thread) => {
      setTab("diff");
      setPicked(path);
      if (!inAny(chosen, path)) setKept([]);
      setFilter((q) => (q && !path.toLowerCase().includes(q.trim().toLowerCase()) ? "" : q));
      // Opened, not unmarked: it stays viewed, here and on GitHub.
      setOpened((s) => (s.has(path) ? s : new Set([...s, path])));
      // After the tab and the list have drawn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => (thread ? diffs.current?.scrollToThread(thread) : line ? diffs.current?.scrollToLine(path, line, side) : diffs.current?.scrollToFile(path))),
      );
    },
    [chosen, setKept, setTab],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (!stops.length) return;
      const next = (stop + by + stops.length) % stops.length;
      setStop(next);
      const at = stops[next]!;
      jump(at.path, at.line, at.side, at.thread);
    },
    [stop, stops, jump],
  );
  // n and p step through the comments, like a reader's next and previous. The filters' shortcuts are
  // Focus Diff's own (⌥⇧. and ⌥⇧, for next and previous filter, ⌥⇧0 for all files, ⌥⇧J for the next
  // file to review), read by key position, since ⌥ changes the character typed.
  const filterKeys = useRef({ stepPart, choose, goToNextFile, stepToFile, toggleViewedAtTop });
  useLayoutEffect(() => {
    filterKeys.current = { stepPart, choose, goToNextFile, stepToFile, toggleViewedAtTop };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return;
      // ⌘] on to the next pull request of the queue and ⌘[ back, as forward and back in Safari.
      if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        void (e.key === "]" ? goNextRef : goBackRef).current();
        return;
      }
      // Taken already (a menu's type-to-select, the file tree's arrows): not a shortcut.
      if (e.metaKey || e.ctrlKey) return;
      if (e.altKey && e.shiftKey) {
        const keys = filterKeys.current;
        const action = { Period: () => keys.stepPart(1), Comma: () => keys.stepPart(-1), Digit0: () => keys.choose([]), KeyJ: keys.goToNextFile }[e.code];
        if (!action || !files) return;
        e.preventDefault();
        setTab("diff");
        action();
        return;
      }
      // ? shows every shortcut, from either tab, as on GitHub.
      if (e.key === "?") {
        e.preventDefault();
        setShortcuts(true);
        return;
      }
      if (tab !== "diff" || e.altKey) return;
      if (e.key === "n" || e.key === "p") {
        e.preventDefault();
        step(e.key === "n" ? 1 : -1);
      } else if ((e.key === "j" || e.key === "k" || e.key === "v") && files) {
        // j, k and v as on GitHub: next file, previous file, viewed.
        e.preventDefault();
        if (e.key === "v") filterKeys.current.toggleViewedAtTop();
        else filterKeys.current.stepToFile(e.key === "j" ? 1 : -1);
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
  // Anyone with write access, as GitHub's own merge box allows (usePull.ts, merging.ts).
  const view = pull.view;
  const canMerge = Boolean(view && (view.canMerge || view.canBypass || view.canAutoMerge || view.canDisableAutoMerge || view.canEnqueue || view.canDequeue || view.canUpdateBranch));
  const canLeave = Boolean(details && me && !details.viewerDidAuthor && details.state === "OPEN");
  const leave = async () => {
    if (!details || !me) return;
    const t = i18n();
    if (!(await bridge.confirm(t("review.leaveConfirm", { number: String(details.number) }), t("review.leaveConfirmMessage"), t("review.leaveConfirmButton")))) return;
    void leaveReview(details, me, teams)
      .then(() => {
        say(i18n()("review.left"));
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
      whitespace: () => setWhitespace(!whitespace),
      "file-next": () => {
        setTab("diff");
        requestAnimationFrame(() => stepToFile(1));
      },
      "file-previous": () => {
        setTab("diff");
        requestAnimationFrame(() => stepToFile(-1));
      },
      "toggle-viewed": toggleViewedAtTop,
      shortcuts: () => setShortcuts(true),
      "next-file": goToNextFile,
      "next-comment": () => step(1),
      "previous-comment": () => step(-1),
      "ai-review": () => void runReview(),
      submit: () => setSubmitting(true),
      merge: () => setMergeMenu(true),
      commits: () => {
        setTab("diff");
        requestAnimationFrame(() => setRangeMenu(true));
      },
      ...pull.menu,
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
    "file-next": Boolean(files?.length),
    "file-previous": Boolean(files?.length),
    "toggle-viewed": tab === "diff" && Boolean(files?.length),
    "next-file": Boolean(files?.length),
    "next-comment": stops.length > 0,
    "previous-comment": stops.length > 0,
    "ai-review": Boolean(ai && details && files && !reviewing),
    submit: isOpen,
    merge: Boolean(canMerge),
    commits: Boolean(pull.commits?.commits.length),
    ...pull.allowed,
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
            {t("review.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* One toolbar, as in Xcode or Safari: the view switch right after the traffic lights (and, in
          the Diff, which changes show), the title centred in the window, the Diff's controls and the
          actions at the trailing end. The title gives way first; as the window narrows the branch
          line goes, then the actions fold into a menu, then labels turn into icons. The sides are
          equal columns at least as wide as what's in them, so the title stays centred while it can.
          The bar is a size container so this follows its width. */}
      <header
        data-tauri-drag-region
        className={cn(
          "@container relative z-10 flex shrink-0 items-center justify-between gap-3 bg-background pr-2.5 transition-shadow duration-(--duration)",
          isMac ? "h-(--toolbar-h) pl-(--traffic-lights-inset)" : "h-11 pl-2",
          scrolled && "shadow-[0_1px_0_var(--separator)]",
        )}
      >
        <div ref={leadingRef} data-tauri-drag-region className="flex shrink-0 items-center gap-2">
        {/* The view switch: a capsule with a neutral knob, concentric with the toolbar, as Finder's. */}
        <div role="tablist" onKeyDown={tabKeys} aria-label={t("review.view")} className="relative isolate flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill p-0.5">
          <SlidingPill selected={tab} className="rounded-full bg-(--toolbar-segment-bg) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)]" />
          {(
            [
              ["overview", t("review.overview"), details?.entries.length],
              ["diff", t("review.diff"), files?.length],
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
          {/* Which changes show: all, since your last review, a commit or a run of them. Drawn always,
              opened only in the Diff, so switching tabs moves nothing else. */}
          <div
            aria-hidden={tab !== "diff"}
            inert={tab !== "diff"}
            className={cn(
              "grid shrink-0 transition-[grid-template-columns,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
              tab === "diff" ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
            )}
          >
            <div className="flex min-w-0 overflow-hidden py-1">
              <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
                <RangePicker pull={pull} className={TOOL} open={rangeMenu} onOpenChange={setRangeMenu} />
              </div>
            </div>
          </div>
        </div>

        <div
          data-tauri-drag-region
          style={titleBox ?? undefined}
          className={cn("absolute inset-y-0 flex flex-col items-center justify-center gap-px text-center", !titleBox && "invisible")}
        >
          {details ? (
            <>
              <h1 data-tauri-drag-region className="max-w-full truncate text-headline font-bold" title={details.title}>
                {details.title}
              </h1>
              {/* What just happened shows here for a moment, in place of the branch line, rather than
                  as a toast: a Mac window says it where you're looking. */}
              {notice ? (
                <p role="status" className="max-w-full truncate text-subheadline text-foreground animate-in fade-in-0 duration-(--duration) motion-reduce:animate-none">
                  {notice}
                </p>
              ) : (
                <p data-tauri-drag-region className="max-w-full truncate text-subheadline text-muted-foreground @max-[1280px]:hidden">
                  {repo} #{number} · {firstName(details.author, t)} · <span data-tauri-drag-region className="font-mono">{details.headRefName}</span>
                </p>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-3.5 w-64 max-w-full" />
              <Skeleton className="h-2.5 w-40 max-w-full @max-[1280px]:hidden" />
            </>
          )}
        </div>

        <div ref={trailingRef} data-tauri-drag-region className="flex shrink-0 items-center justify-end gap-1">
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
            <div role="group" aria-label={t("review.comments")} className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL_ICON} aria-label={t("review.previousComment")} disabled={!stops.length} onClick={() => step(-1)} />}>
                  <ChevronUp />
                </TooltipTrigger>
                <TooltipContent>
                  {t("review.previousCommentTip")} <Kbd>p</Kbd>
                </TooltipContent>
              </Tooltip>
              <span className="px-0.5 text-center text-callout text-muted-foreground tabular-nums" aria-live="polite">
                <span className="inline-block min-w-[6.5rem] @max-[1360px]:sr-only">
                  {stops.length ? (stop >= 0 ? t("review.commentOf", { index: stop + 1, total: stops.length }) : t("common.comments", { count: stops.length })) : t("review.noOpenComments")}
                </span>
                <span aria-hidden className="hidden min-w-5 @max-[1360px]:inline-block">
                  {stops.length ? (stop >= 0 ? `${stop + 1}/${stops.length}` : stops.length) : "0"}
                </span>
              </span>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL_ICON} aria-label={t("review.nextComment")} disabled={!stops.length} onClick={() => step(1)} />}>
                  <ChevronDown />
                </TooltipTrigger>
                <TooltipContent>
                  {t("review.nextCommentTip")} <Kbd>n</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
            {/* Layout and wrapping, one capsule of glyphs. */}
            <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              <ToggleGroup value={[diffStyle]} onValueChange={(v: string[]) => v[0] && setDiffStyle(v[0] as "split" | "unified")} spacing={0} aria-label={t("review.layout")} className="h-full rounded-full">
                {(
                  [
                    ["split", t("review.sideBySide"), Columns2],
                    ["unified", t("review.oneColumn"), Rows2],
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
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-primary")} aria-pressed={wrap} aria-label={t("review.wrap")} onClick={() => setWrap(!wrap)} />}>
                  <WrapText />
                </TooltipTrigger>
                <TooltipContent>{t("review.wrapTip")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-primary")} aria-pressed={whitespace} aria-label={t("diff.hideWhitespace")} onClick={() => setWhitespace(!whitespace)} />}
                >
                  <Pilcrow />
                </TooltipTrigger>
                <TooltipContent>{t("diff.hideWhitespaceTip")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* The person's own actions, AI, readiness and merging: one capsule of labelled items. The
              actions fold into a pull-down menu as the window narrows. */}
          {(config?.actions.length && details && me) || (ai && details) || canMerge || (details?.viewerCanUpdate && isOpen && details.isDraft) ? (
            <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              {config?.actions.length && details && me ? (
                <>
                  <div className="contents @max-[1600px]:hidden">
                    <ActionButtons
                      actions={config.actions}
                      className={TOOL}
                      pr={{ number: details.number, repo, title: details.title, url: details.url, author: details.author?.login ?? "", me }}
                      onResult={actionResult}
                    />
                  </div>
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "hidden @max-[1600px]:inline-flex")} aria-label={t("review.actions")} />} />}>
                        <Zap />
                      </TooltipTrigger>
                      <TooltipContent>{t("review.actions")}</TooltipContent>
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
                  <TooltipTrigger render={<Button variant="ghost" className={cn(TOOL, "@max-[1360px]:w-(--toolbar-item-h) @max-[1360px]:px-0")} onClick={() => void runReview()} disabled={Boolean(reviewing) || !files} />}>
                    {reviewing ? <Loader2 className="animate-spin" /> : <Sparkles />}
                    <span className="@max-[1360px]:sr-only">{current ? t("review.reviewAgain") : t("review.aiReview")}</span>
                  </TooltipTrigger>
                  <TooltipContent>{aiProblemNow ? aiProblemNow.title : current ? t("review.reviewAgainTip") : t("review.aiReviewTip")}</TooltipContent>
                </Tooltip>
              ) : null}
              {details && details.viewerCanUpdate && isOpen && details.isDraft ? (
                <Button variant="ghost" className={TOOL} onClick={() => void pull.actions.ready()} disabled={pull.busy === "ready"}>
                  {t("review.markReady")}
                </Button>
              ) : null}
              {canMerge && details ? (
                // A pull-down button: how to merge, then a native alert to confirm (it can't be undone).
                <DropdownMenu open={mergeMenu} onOpenChange={setMergeMenu}>
                  <DropdownMenuTrigger render={<Button variant="ghost" className={cn(TOOL, "gap-1 @max-[1360px]:px-2")} />}>
                    <GitMerge /> <span className="@max-[1360px]:sr-only">{t("review.merge")}</span>
                    <ChevronDown className="size-3 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <MergeMenuItems details={details} pull={pull} onDetails={() => setTab("overview")} />
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={cn(TOOL_ICON, "bg-fill")} aria-label={t("review.more")} />} />}>
                <MoreHorizontal />
              </TooltipTrigger>
              <TooltipContent>{t("review.more")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => details && void bridge.openUrl(details.url)}>{t("review.openOnGitHub")}</DropdownMenuItem>
              <PullMenuItems pull={pull} details={details} />
              <DropdownMenuItem onClick={() => setShortcuts(true)}>{t("diff.shortcuts")}</DropdownMenuItem>
              {canLeave ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void leave()}>{t("review.leaveMenu")}</DropdownMenuItem>
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
              onSubmit={(event, body) => pending.submit(details, event, body)}
              onDiscard={async () => {
                await pending.discard(details);
                say(i18n()("review.reviewDiscarded"));
              }}
              onSubmitted={() => {
                say(i18n()("review.reviewSent"));
                void changed();
              }}
            />
          ) : null}
          {/* Back to the pull request shown before and on to the next of the queue it was opened
              from, in this window, as back and forward in Safari: the last item, where the eye goes
              once the review is sent. */}
          {nextPull || previous ? (
            <div role="group" aria-label={t("review.pullNavigation")} className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={TOOL_ICON}
                      disabled={!previous}
                      aria-label={previous ? t("review.backToLabel", { number: String(previous.pr.number), title: previous.pr.title }) : t("review.back")}
                      aria-keyshortcuts="Meta+["
                      onClick={() => void goBack()}
                    />
                  }
                >
                  <ChevronLeft />
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <span className="block font-semibold">
                    {t("review.back")} <Kbd>⌘[</Kbd>
                  </span>
                  {previous ? (
                    <span className="block truncate">
                      #{previous.pr.number} · {previous.pr.title}
                    </span>
                  ) : null}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      className={cn(TOOL, "gap-1 pr-2 @max-[1360px]:w-(--toolbar-item-h) @max-[1360px]:px-0")}
                      disabled={!nextPull}
                      aria-label={nextPull ? t("review.nextPullLabel", { queue: queueName, number: String(nextPull.pr.number), title: nextPull.pr.title }) : t("review.nextPull")}
                      aria-keyshortcuts="Meta+]"
                      onClick={() => void goNext()}
                    />
                  }
                >
                  <span className="@max-[1360px]:sr-only">{t("review.nextPull")}</span>
                  <ChevronRight />
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <span className="block font-semibold">
                    {queueName ? t("review.nextPullIn", { queue: queueName }) : t("review.nextPull")} <Kbd>⌘]</Kbd>
                  </span>
                  {nextPull ? (
                    <span className="block truncate">
                      #{nextPull.pr.number} · {nextPull.pr.title}
                    </span>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>
        </div>
      </header>

      {/* What the comments in both tabs can do (conversation.tsx). */}
      <ConversationProvider value={talk.api}>
      <main className="relative flex min-h-0 flex-1 flex-col" onScrollCapture={(e) => setScrolled((e.target as HTMLElement).scrollTop > 0)}>
        {newChanges ? (
          // Over the top of either tab, as GitHub's bar, without moving what's under it.
          <div role="status" className="absolute top-2 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-3 text-callout shadow-(--shadow-menu) animate-in fade-in-0 slide-in-from-top-2 duration-(--duration) motion-reduce:animate-none">
            <GitCommitHorizontal className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("review.newChanges")}</span>
            <Button className="shrink-0 rounded-full" onClick={() => void update()} disabled={updating}>
              {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t("review.update")}
            </Button>
          </div>
        ) : null}
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"} className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
          {details ? (
            <Overview
              config={config}
              details={details}
              conversation={talk.conversation}
              threads={conversations}
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
                const id = await comment(details, body);
                say(i18n()("review.commentPosted"));
                await changed();
                return id;
              }}
              pull={pull}
              me={me}
              onOpenRange={(range) => {
                pull.setRange(range);
                setTab("diff");
                requestAnimationFrame(() => diffs.current?.scrollToTop());
              }}
              hasFile={(path) => Boolean(files?.some((f) => f.path === path))}
              say={say}
            />
          ) : (
            // The Overview's own layout, empty: nothing moves when it fills in.
            <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true" aria-label={t("review.loading")}>
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
          <aside className="flex w-72 shrink-0 flex-col border-r" aria-label={t("review.files")}>
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
                  placeholder={t("review.filterFilesPlaceholder")}
                  aria-label={t("review.filterFiles")}
                  className="rounded-full pr-6 pl-7 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                />
                {filter ? (
                  <button type="button" aria-label={t("review.clear")} onClick={() => setFilter("")} className="absolute top-1/2 right-1.5 grid size-3.5 -translate-y-1/2 cursor-default place-items-center rounded-full bg-muted-foreground/60 text-background outline-none focus-ring">
                    <X className="size-2.5" strokeWidth={3} aria-hidden />
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-subheadline text-muted-foreground">
                <Progress value={inPart.length ? (viewedCount / inPart.length) * 100 : 0} className="flex-1" aria-label={t("review.filesViewed")} />
                <span className="tabular-nums">
                  {t("review.viewedOf", { viewed: viewedCount, total: inPart.length })}
                </span>
              </div>
              <label className="flex items-center gap-1.5 text-body">
                <Checkbox checked={hideViewed} onCheckedChange={setHideViewed} className="size-3.5" /> {t("review.hideViewed")}
              </label>
            </div>
            <FileTree
              files={shownFiles ? visible : null}
              flat={Boolean(filter.trim())}
              picked={picked}
              isViewed={isViewed}
              comments={(path) => threadsByPath.get(path)?.filter((t) => !t.resolved).length ?? 0}
              onPick={(path) => {
                setPicked(path);
                diffs.current?.scrollToFile(path);
              }}
            />
          </aside>

          <div className="relative min-w-0 flex-1 bg-muted/30">
            <RangeBanner pull={pull} below={Boolean(newChanges)} loading={Boolean(pull.range && !ranged.files && !ranged.error)} error={ranged.error} />
            {shownFiles ? (
              visible.length ? (
                <Diffs
                  ref={diffs}
                  files={visible}
                  threads={olderRange ? new Map() : threadsByPath}
                  commentable={!olderRange}
                  drafts={drafts}
                  findings={current?.findings ?? []}
                  findingsBy={ai ? PROVIDERS[ai.ai.provider!].name : t("review.ai")}
                  onAcceptFinding={(f, side) => {
                    pending.add({ path: f.path, side, line: f.line, body: f.body });
                    dropFinding(f);
                  }}
                  onDismissFinding={dropFinding}
                  onAsk={
                    ai && details && files
                      ? async (path, range, question, earlier, run) => {
                          if (!(await ensureAi(ai))) throw new Error(i18n()("shared.aiNotReady", { provider: PROVIDERS[ai.ai.provider!].name }));
                          return askAboutLines(ai, details, files, path, Math.min(range.start, range.end), Math.max(range.start, range.end), range.endSide ?? range.side ?? "additions", question, earlier, run);
                        }
                      : null
                  }
                  isViewed={isViewed}
                  diffStyle={diffStyle}
                  wrap={wrap}
                  whitespace={whitespace}
                  source={diffSource}
                  link={link}
                  onSay={say}
                  dark={dark}
                  opened={opened}
                  onViewed={setFileViewed}
                  onAddDraft={pending.add}
                  onEditDraft={pending.edit}
                  onRemoveDraft={pending.remove}
                  onCommentNow={async (draft) => {
                    if (!details) return;
                    await commentNow(details, { ...draft, key: "now" });
                    say(i18n()("review.commentPosted"));
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
                <p className="p-10 text-center text-body text-muted-foreground">{chosen.length && !inPart.length ? t("review.noFilesIn", { filters: chosen.map((f) => f.name).join(" + ") }) : t("review.noFilesMatch")}</p>
              )
            ) : (
              <div className="flex flex-col gap-3 p-3" aria-busy="true" aria-label={t("review.loadingFiles")}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-48 rounded-xl" />
                ))}
              </div>
            )}
            <SuggestionBatch />
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
      </ConversationProvider>
      <Shortcuts open={shortcuts} onOpenChange={setShortcuts} />
    </div>
  );
}
