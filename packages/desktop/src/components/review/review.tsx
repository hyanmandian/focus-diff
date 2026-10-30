import { createEstimator, LINES_PER_HOUR, reviewMinutes } from "@focus-diff/core/estimate";
import { inFilter } from "@focus-diff/core/filters";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GitCommitHorizontal,
  GitMerge,
  Loader2,
  MoreHorizontal,
  Pilcrow,
  RefreshCw,
  Rows2,
  Search,
  Sparkles,
  Square,
  WrapText,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ActionButtons, ActionMenuItems } from "@/components/action-buttons/action-buttons";
import { Badge } from "@/components/badge/badge";
import { Button } from "@/components/button/button";
import { Checkbox } from "@/components/checkbox/checkbox";
import { CommentNav } from "@/components/comment-nav/comment-nav";
import { RangeBanner, RangePicker } from "@/components/commits/commits";
import { Diffs, type DiffsHandle, type LinkTarget } from "@/components/diffs/diffs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { FileTree } from "@/components/file-tree/file-tree";
import { FilterBar, type Next } from "@/components/filter-bar/filter-bar";
import { FindBar } from "@/components/find-bar/find-bar";
import { Input } from "@/components/input/input";
import { Kbd } from "@/components/kbd/kbd";
import { Overview } from "@/components/overview/overview";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/popover/popover";
import { Progress } from "@/components/progress/progress";
import { MergeMenuItems, PullMenuItems } from "@/components/pull-menus/pull-menus";
import { PullState } from "@/components/pull-state/pull-state";
import { Shortcuts } from "@/components/shortcuts/shortcuts";
import { Skeleton } from "@/components/skeleton/skeleton";
import { SlidingPill } from "@/components/sliding-pill/sliding-pill";
import { StackMenu } from "@/components/stack-menu/stack-menu";
import { SuggestionBatch } from "@/components/suggestion/suggestion";
import { Textarea } from "@/components/textarea/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { useActiveTime } from "@/hooks/use-active-time/use-active-time";
import { useAttempt } from "@/hooks/use-attempt/use-attempt";
import { ConversationProvider, copyText, useConversation } from "@/hooks/use-conversation/use-conversation";
import { useNewChanges } from "@/hooks/use-new-changes/use-new-changes";
import { useNextInQueue, type Visit } from "@/hooks/use-next-in-queue/use-next-in-queue";
import { published, usePending } from "@/hooks/use-pending/use-pending";
import { usePersisted } from "@/hooks/use-persisted/use-persisted";
import { usePull } from "@/hooks/use-pull/use-pull";
import { useStack } from "@/hooks/use-stack/use-stack";
import { aiProblem, ensureAi, useAiProblem } from "@/utils/ai-ready/ai-ready";
import { ReviewStopped, reviewRun, startReview, stopReview } from "@/utils/ai-runs/ai-runs";
import { askAboutLines, PROVIDERS, review as aiReview, type AiReview, type Finding } from "@/utils/ai/ai";
import { bridge, isRecord } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import { useRangeFiles } from "@/utils/commits/commits";
import { confetti } from "@/utils/confetti/confetti";
import { loadConfig, type Config } from "@/utils/config/config";
import { mergeBase, type Source } from "@/utils/contents/contents";
import { firstName } from "@/utils/copy/copy";
import { comment, leaveReview, loadDetails, type Details } from "@/utils/details/details";
import { errorText } from "@/utils/error/error";
import { learnFiles, useLearned } from "@/utils/estimate/estimate";
import {
  filtersFor,
  inAny,
  keptSelection,
  nextFile,
  nextFilterWithWork,
  stepFilter,
  toggled,
  totals,
} from "@/utils/filters/filters";
import { findInPatches, type FindMatch } from "@/utils/find/find";
import { patchHash } from "@/utils/hashes/hashes";
import { i18n, useT } from "@/utils/i18n/i18n";
import { keep, readKept, type Kept } from "@/utils/kept/kept";
import { tabKeys, typing } from "@/utils/keys/keys";
import { stepFile } from "@/utils/navigate/navigate";
import { isMac, primary, shortcut } from "@/utils/os/os";
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
import { useTheme } from "@/utils/theme/theme";
import { inTreeOrder } from "@/utils/tree/tree";

export type Target = { id: string; repo: string; number: number; teams: string[]; queue?: string | null | undefined };

const MIN_REVIEW_SECONDS = 2;

const isDark = () => document.documentElement.classList.contains("dark");
const watchDark = (changed: () => void) => {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
  };
};
const useDark = () => useSyncExternalStore(watchDark, isDark);

const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isAnything = (v: unknown): v is unknown => v !== undefined;
const isDiffStyle = (v: unknown): v is "split" | "unified" => v === "split" || v === "unified";
const isTab = (v: unknown): v is "overview" | "diff" => v === "overview" || v === "diff";
const isMarks = (v: unknown): v is Record<string, string> => isRecord(v) && Object.values(v).every((x) => isString(x));
const isReviewed = (v: unknown): v is { head: string; review: AiReview } | null =>
  v === null || (isRecord(v) && isString(v.head) && isRecord(v.review));

const EVENTS = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const;
const STYLES = ["split", "unified"] as const;

type Event = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const TOOL =
  "h-(--toolbar-item-h) rounded-full px-2.5 text-muted-foreground hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed) aria-expanded:text-foreground";
const TOOL_ICON =
  "size-(--toolbar-item-h) rounded-full px-0 text-muted-foreground hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed) aria-expanded:text-foreground";

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
  onSubmit: (event: Event, body: string) => Promise<void>;
  onDiscard: () => Promise<void>;
  onSubmitted: () => void;
}) {
  const t = useT();
  const own = details.viewerDidAuthor;
  const setOpen = onOpenChange;
  const [event, setEvent] = useState<Event>("COMMENT");
  const [body, setBody] = usePersisted(`review-body:${details.id}`, "", isString);
  const { busy, error, attempt } = useAttempt();
  const submit = () =>
    attempt(async () => {
      await onSubmit(event, body);
      setBody("");
      setOpen(false);
      onSubmitted();
    });
  const discard = async () => {
    const tr = i18n();
    if (
      !(await bridge.confirm(
        tr("review.discardConfirm"),
        tr("review.discardConfirmMessage", { count: drafts.length }),
        tr("review.discardConfirmButton"),
      ))
    )
      return;
    await attempt(async () => {
      await onDiscard();
      setOpen(false);
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button className="h-(--toolbar-item-h) rounded-full px-3.5" />}>
        <span className="@max-[860px]:hidden">{t("review.submit")}</span>
        <span className="hidden @max-[860px]:inline">{t("review.submitShort")}</span>
        {drafts.length > 0 ? (
          <Badge variant="secondary" className="ml-0.5 bg-white/25 text-primary-foreground">
            {drafts.length}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3">
          <PopoverTitle>{t("review.finishTitle")}</PopoverTitle>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
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
          <ToggleGroup
            value={[event]}
            onValueChange={(v: string[]) => {
              const picked = EVENTS.find((e) => e === v[0]);
              if (picked) setEvent(picked);
            }}
            variant="outline"
            aria-label={t("review.kindOfReview")}
            className="w-full"
          >
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
          {drafts.length > 0 ? (
            <p className="text-callout text-muted-foreground">{t("review.sendsPending", { count: drafts.length })}</p>
          ) : null}
          {error ? (
            <p className="text-callout text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {drafts.length > 0 ? (
              <Button variant="destructive" className="mr-auto" disabled={busy} onClick={() => void discard()}>
                {t("review.discardReview")}
              </Button>
            ) : null}
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {event === "APPROVE"
                ? t("review.approve")
                : event === "REQUEST_CHANGES"
                  ? t("review.requestChanges")
                  : t("review.comment")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type Stop = {
  path: string;
  line: number;
  side: Thread["side"];
  kind: "conversation" | "pending" | "ai";
  thread?: Thread;
};

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
  const [find, setFind] = useState<{ query: string; at: number } | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  const [hideViewed, setHideViewed] = useState(false);
  const [diffStyle, setDiffStyle] = usePersisted("diff-style", "split", isDiffStyle);
  const [wrap, setWrap] = usePersisted("diff-wrap", false, isBoolean);
  const [whitespace, setWhitespace] = usePersisted("diff-whitespace", false, isBoolean);
  const [shortcuts, setShortcuts] = useState(false);
  const [viewed, setViewed] = usePersisted<Record<string, string>>(`viewed:${prId}`, {}, isMarks);
  const [tab, setTab] = usePersisted<"overview" | "diff">(`tab:${prId}`, "overview", isTab);
  const [stop, setStop] = useState(-1);
  const [kept, setKept] = usePersisted<unknown>(`filter:${repo}`, [], isAnything);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const learned = useLearned();
  const here = useMemo<Visit | null>(
    () =>
      details
        ? {
            pr: {
              id: prId,
              number,
              title: details.title,
              repository: { nameWithOwner: repo },
              author: details.author ? { login: details.author.login } : null,
            },
            teams,
            queue: target.queue ?? null,
          }
        : null,
    [details, prId, number, repo, teams, target.queue],
  );
  const { next: nextPull, go: goNext, goTo, previous, back: goBack } = useNextInQueue(target.queue, prId, here);
  const stack = useStack(details);
  const upStack = stack && stack.at < stack.pulls.length - 1 ? stack.pulls[stack.at + 1] : null;
  const visitOf = (pull: StackPull): Visit => ({
    pr: {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      repository: { nameWithOwner: repo },
      author: pull.author,
    },
    teams: [],
    queue: target.queue ?? null,
  });
  const queueName = config?.queues.find((q) => q.id === target.queue)?.name ?? "";
  const queueLabel = queueName || t("review.theQueue");
  const say = (message: string) => {
    setNotice(message);
    window.setTimeout(() => {
      setNotice((n) => (n === message ? null : n));
    }, 3500);
  };
  const nextInQueue = async () => {
    if (upStack) return goTo(visitOf(upStack));
    if (!(await goNext())) say(t("review.queueDone", { queue: queueName || t("review.theQueue") }));
  };
  const markDone = async () => {
    if (!(await goNext(true))) say(t("review.doneQueueDone", { queue: queueLabel }));
  };
  const minutesOf = useMemo(() => createEstimator(LINES_PER_HOUR, learned), [learned]);
  const [reviewed, setReviewed] = usePersisted<{ head: string; review: AiReview } | null>(
    `ai-review:${prId}`,
    null,
    isReviewed,
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  useTheme(config?.theme);
  const dark = useDark();
  const diffs = useRef<DiffsHandle>(null);
  const [me, setMe] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mergeMenu, setMergeMenu] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const [titleBox, setTitleBox] = useState<{ left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const leading = leadingRef.current!;
    const trailing = trailingRef.current!;
    const bar = leading.parentElement!;
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
    return () => {
      observer.disconnect();
    };
  }, []);
  const filterField = useRef<HTMLInputElement>(null);

  const ref = useMemo(() => ({ owner: repo.split("/")[0]!, repo: repo.split("/")[1]!, number }), [repo, number]);
  const pending = usePending(prId, ref, threads);
  const drafts = pending.drafts;
  const conversations = useMemo(() => published(threads), [threads]);
  const head = details?.headRefOid;
  const source = useMemo<Source | null>(
    () => (head ? { repo, head, base: () => mergeBase(ref, head) } : null),
    [repo, ref, head],
  );
  const link = useMemo<LinkTarget | null>(() => (head ? { ...ref, head } : null), [ref, head]);
  const shownOnce = useRef(false);
  const followGitHub = useCallback(
    (list: ReviewFile[], states: Map<string, ViewedState>, queued: Record<string, boolean>) => {
      setViewed((m) => {
        const next = { ...m };
        for (const f of list) {
          const state = states.get(f.path);
          const mine = m[f.path];
          if (!state || f.path in queued) continue;
          if (mine === "" || mine === patchHash(f)) {
            if ((state === "VIEWED") !== (mine !== "")) void bridge.queueViewed(prId, f.path, mine !== "");
          } else if (state === "VIEWED") next[f.path] = patchHash(f);
          else delete next[f.path];
        }
        return next;
      });
    },
    [setViewed, prId],
  );
  const last = useRef<Kept | null>(null);
  const load = useCallback(async () => {
    const onGitHub = loadViewed(ref).catch(() => null);
    const asked = loadDetails(repo, number);
    try {
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
      let d: Details, f: ReviewFile[], th: Thread[];
      if (before) {
        d = await asked;
        setDetails(d);
        const sameFiles = before.details.headRefOid === d.headRefOid && before.details.baseRefName === d.baseRefName;
        [f, th] = await Promise.all([
          sameFiles ? before.files : loadFiles(ref, d.changedFiles).then((got) => (setFiles(got), got)),
          before.details.updatedAt === d.updatedAt
            ? before.threads
            : loadThreads(ref).then((got) => (setThreads(got), got)),
        ]);
      } else {
        [d, f, th] = await Promise.all([
          asked.then((got) => (setDetails(got), got)),
          loadFiles(ref).then((got) => (setFiles(got), got)),
          loadThreads(ref).then((got) => (setThreads(got), got)),
        ]);
      }
      shownOnce.current = true;
      last.current = { details: d, files: f, threads: th };
      setError(null);
      performance.mark("loaded");
      void keep(prId, last.current, d.updatedAt);
      const [states, queued] = await Promise.all([onGitHub, bridge.queuedViewed(prId).catch(() => ({}))]);
      if (states) followGitHub(f, states, queued);
    } catch (e) {
      setError(errorText(e));
    }
  }, [prId, repo, number, ref, followGitHub]);

  useEffect(() => {
    void loadConfig().then(setConfig);
    void bridge
      .authStatus()
      .then((a) => a.login)
      .then(setMe);
    // oxlint-disable-next-line react/set-state-in-effect -- it fetches: what it sets comes after GitHub answers, not during the effect
    void load();
  }, [load]);
  useEffect(() => {
    const off = bridge.on<string>("file-changed", (name) => {
      if (name === "config") void loadConfig().then(setConfig);
      if (name === "auth")
        void bridge
          .authStatus()
          .then((a) => a.login)
          .then(setMe);
    });
    return off;
  }, []);

  const ai = config?.ai.provider ? config : null;
  const current = reviewed && details && reviewed.head === details.headRefOid ? reviewed.review : null;
  const aiProblemNow = useAiProblem(ai);
  const projectHead = ai?.ai.project && details?.state === "OPEN" ? details.headRefOid : null;
  useEffect(() => {
    if (projectHead && !aiProblemNow) void bridge.aiPrepare({ repo, number, head: projectHead }).catch(() => {});
  }, [projectHead, aiProblemNow, repo, number]);
  const runReview = useCallback(
    async (asked = true) => {
      if (!ai || !details || !files) return;
      if (asked ? !(await ensureAi(ai)) : await aiProblem(ai)) return;
      setReviewing(details.headRefOid);
      setReviewError(null);
      setStoppedAt(null);
      try {
        setReviewed(await startReview(prId, details.headRefOid, (run) => aiReview(ai, details, files, run)));
      } catch (e) {
        if (e instanceof ReviewStopped) setStoppedAt(details.headRefOid);
        else setReviewError(errorText(e));
      } finally {
        setReviewing(null);
      }
    },
    [ai, details, files, setReviewed, prId],
  );
  useEffect(() => {
    const run = reviewRun(prId);
    if (!run) return;
    let mounted = true;
    // oxlint-disable-next-line react/set-state-in-effect -- picks up a review still running from an earlier visit to this pull request
    setReviewing(run.head);
    void (async () => {
      try {
        const done = await run.done;
        if (mounted) setReviewed(done);
      } catch (e) {
        if (!mounted) return;
        if (e instanceof ReviewStopped) setStoppedAt(run.head);
        else setReviewError(errorText(e));
      } finally {
        if (mounted) setReviewing(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [prId, setReviewed]);
  useEffect(() => {
    if (
      ai?.ai.review.auto &&
      details &&
      files &&
      !current &&
      !reviewing &&
      !reviewError &&
      stoppedAt !== details.headRefOid &&
      details.state === "OPEN"
    )
      // oxlint-disable-next-line react/set-state-in-effect -- it sets state only once the AI's readiness is known (awaited)
      void runReview(false);
  }, [ai, details, files, current, reviewing, reviewError, stoppedAt, runReview]);
  const stopAiReview = () => {
    stopReview(prId);
  };
  const dropFinding = (finding: Finding) => {
    setReviewed((r) =>
      r
        ? {
            ...r,
            review: {
              ...r.review,
              findings: r.review.findings.filter(
                (f) =>
                  f !== finding && !(f.path === finding.path && f.line === finding.line && f.body === finding.body),
              ),
            },
          }
        : r,
    );
  };

  const talk = useConversation({
    prId,
    ref,
    details,
    threads,
    setThreads,
    files,
    me,
    pending,
    say,
    reloadAll: () => void load(),
  });
  const reloadConversation = talk.reload;
  const pull = usePull({ prId, ref, details, setDetails, threads, say, reloadAll: () => void load() });
  const [rangeMenu, setRangeMenu] = useState(false);
  const ranged = useRangeFiles(ref, pull.range);
  const shownFiles = pull.range ? ranged.files : files;
  const pullFiles = useMemo(() => new Map((files ?? []).map((f) => [f.path, f])), [files]);
  const pullFileOf = useCallback((f: ReviewFile) => pullFiles.get(f.path) ?? f, [pullFiles]);
  const range = pull.range;
  const olderRange = Boolean(range && details && range.to !== details.headRefOid);
  const diffSource = useMemo<Source | null>(
    () => (range ? { repo, head: range.to, base: () => Promise.resolve(range.from) } : source),
    [range, repo, source],
  );

  const changed = useCallback(async () => {
    void bridge.refresh(true);
    void reloadConversation();
    try {
      const [th, d] = await Promise.all([loadThreads(ref), loadDetails(repo, number)]);
      setThreads(th);
      setDetails(d);
      if (last.current) last.current = { ...last.current, details: d, threads: th };
    } catch {}
  }, [ref, repo, number, reloadConversation]);

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
  const repoFilters = useMemo(() => filtersFor(config?.filters ?? [], repo), [config, repo]);
  const chosen = useMemo(() => {
    const ids = keptSelection(kept);
    return repoFilters.filter((f) => ids.includes(f.id) && (!files || files.some((x) => inFilter(f, x.path))));
  }, [kept, repoFilters, files]);
  const chosenIds = useMemo(() => chosen.map((f) => f.id), [chosen]);
  const ordered = useMemo(() => (shownFiles ? inTreeOrder(shownFiles) : []), [shownFiles]);
  const inPart = useMemo(() => ordered.filter((f) => inAny(chosen, f.path)), [ordered, chosen]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return inPart.filter(
      (f) => (!q || f.path.toLowerCase().includes(q)) && (!hideViewed || !isViewed(f) || opened.has(f.path)),
    );
  }, [inPart, filter, hideViewed, isViewed, opened]);
  const findMatches = useMemo(
    () =>
      find
        ? findInPatches(
            visible.map((f) => ({ path: f.path, patch: f.patch })),
            find.query,
          )
        : [],
    [find, visible],
  );
  const viewedCount = inPart.filter((f) => isViewed(f)).length;
  const shown = useMemo(() => totals(inPart, isViewed, minutesOf), [inPart, isViewed, minutesOf]);
  const next = useMemo<Next>(() => {
    const left = visible.filter((f) => !isViewed(f)).length;
    return {
      left,
      nextFilter:
        chosen.length > 0 && !left ? nextFilterWithWork(files ?? [], repoFilters, chosenIds, isViewed) : undefined,
    };
  }, [visible, isViewed, chosen, chosenIds, files, repoFilters]);

  const choose = useCallback(
    (ids: string[]) => {
      setKept(ids);
      requestAnimationFrame(() => diffs.current?.scrollToTop());
    },
    [setKept],
  );
  const stepPart = (by: 1 | -1) => {
    choose(
      stepFilter(
        repoFilters.filter((f) => files?.some((x) => inFilter(f, x.path))).map((f) => f.id),
        chosenIds,
        by,
      ),
    );
  };
  const goToNextFile = () => {
    setTab("diff");
    const upcoming = nextFile(
      [...visible.filter((f) => f.patch), ...visible.filter((f) => !f.patch)],
      isViewed,
      diffs.current?.atTop() ?? null,
    );
    if (upcoming) requestAnimationFrame(() => diffs.current?.scrollToFile(upcoming.path));
    else if (next.nextFilter) choose([next.nextFilter.id]);
  };

  const stepToFile = (by: 1 | -1) => {
    const path = stepFile(diffs.current?.listed() ?? [], diffs.current?.atTop() ?? null, by);
    if (!path) return;
    setPicked(path);
    diffs.current?.scrollToFile(path);
  };
  const toggleViewedAtTop = () => {
    const top = diffs.current?.atTop();
    const file = top && visible.find((f) => f.path === top.path);
    if (file) setFileViewed(file, !isViewed(file));
  };

  const take = useActiveTime(() => diffs.current?.onScreen() ?? [], tab === "diff");
  const setFileViewed = (f: ReviewFile, v: boolean) => {
    if (v && !isViewed(f) && inPart.includes(f) && inPart.every((x) => x === f || isViewed(x)))
      confetti({ x: innerWidth / 2, y: innerHeight - 64 });
    setViewed((m) => ({ ...m, [f.path]: v ? patchHash(pullFileOf(f)) : "" }));
    if (v) {
      setOpened((s) => (s.has(f.path) ? new Set([...s].filter((p) => p !== f.path)) : s));
      const seconds = take(f.path);
      if (seconds >= MIN_REVIEW_SECONDS)
        void learnFiles([{ path: f.path, expected: reviewMinutes(f.path, f), actual: seconds / 60 }]);
    }
    void bridge.queueViewed(prId, f.path, v);
  };

  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const th of conversations) map.set(th.path, [...(map.get(th.path) ?? []), th]);
    return map;
  }, [conversations]);

  const stops = useMemo<Stop[]>(() => {
    const order = new Map(ordered.map((f, i) => [f.path, i]));
    const all: Stop[] = [
      ...conversations
        .filter((th) => !th.resolved)
        .map((th) => ({ path: th.path, line: th.line, side: th.side, kind: "conversation" as const, thread: th })),
      ...drafts.map((d) => ({ path: d.path, line: d.line, side: d.side, kind: "pending" as const })),
      ...(current?.findings
        .filter((f) => f.inDiff)
        .map((f) => ({ path: f.path, line: f.line, side: "additions" as const, kind: "ai" as const })) ?? []),
    ];
    return all
      .filter((x) => order.has(x.path))
      .toSorted((a, b) => order.get(a.path)! - order.get(b.path)! || a.line - b.line);
  }, [ordered, conversations, drafts, current]);

  const jump = (path: string, line: number | null, side?: Thread["side"], thread?: Thread) => {
    setTab("diff");
    setPicked(path);
    if (!inAny(chosen, path)) setKept([]);
    setFilter((q) => (q && !path.toLowerCase().includes(q.trim().toLowerCase()) ? "" : q));
    setOpened((s) => (s.has(path) ? s : new Set([...s, path])));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (thread) diffs.current?.scrollToThread(thread);
        else if (line) diffs.current?.scrollToLine(path, line, side);
        else diffs.current?.scrollToFile(path);
      });
    });
  };
  const showFound = (query: string, matches: FindMatch[], at: number) => {
    const match = matches[at];
    setFind({ query, at });
    diffs.current?.find(query, match ?? null);
    if (match) jump(match.path, match.line, match.side);
  };
  const openFind = () => {
    setTab("diff");
    setFind((f) => f ?? { query: "", at: -1 });
    setFindFocus((n) => n + 1);
  };
  const stepFind = (by: 1 | -1) => {
    if (!find || findMatches.length === 0) return;
    const total = findMatches.length;
    showFound(find.query, findMatches, (find.at + by + total) % total);
  };
  const closeFind = () => {
    setFind(null);
    diffs.current?.find("", null);
  };
  const step = (by: 1 | -1) => {
    if (stops.length === 0) return;
    const from = stop >= stops.length || (stop < 0 && by < 0) ? 0 : stop;
    const index = (from + by + stops.length) % stops.length;
    setStop(index);
    const at = stops[index]!;
    jump(at.path, at.line, at.side, at.thread);
  };
  const onReviewKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || typing(e.target) || document.querySelector('[aria-modal="true"]')) return;
    if (primary(e) && !e.shiftKey && !e.altKey && (e.key === "]" || e.key === "[")) {
      e.preventDefault();
      void (e.key === "]" ? nextInQueue : goBack)();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (e.altKey && e.shiftKey) {
      const action = {
        Period: () => {
          stepPart(1);
        },
        Comma: () => {
          stepPart(-1);
        },
        Digit0: () => {
          choose([]);
        },
        KeyJ: goToNextFile,
      }[e.code];
      if (!action || !files) return;
      e.preventDefault();
      setTab("diff");
      action();
      return;
    }
    if (e.key === "e" && !e.altKey && target.queue) {
      e.preventDefault();
      void markDone();
      return;
    }
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
      e.preventDefault();
      if (e.key === "v") toggleViewedAtTop();
      else stepToFile(e.key === "j" ? 1 : -1);
    }
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      onReviewKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const actionResult = (message: string, ok: boolean) => {
    say(message);
    if (ok) {
      void bridge.refresh(true);
      void load();
    }
  };
  const view = pull.view;
  const canMerge = Boolean(
    view &&
    (view.canMerge ||
      view.canBypass ||
      view.canAutoMerge ||
      view.canDisableAutoMerge ||
      view.canEnqueue ||
      view.canDequeue ||
      view.canUpdateBranch),
  );
  const canLeave = Boolean(details && me && !details.viewerDidAuthor && details.state === "OPEN");
  const leave = async () => {
    if (!details || !me) return;
    const tr = i18n();
    if (
      !(await bridge.confirm(
        tr("review.leaveConfirm", { number: String(details.number) }),
        tr("review.leaveConfirmMessage"),
        tr("review.leaveConfirmButton"),
      ))
    )
      return;
    try {
      await leaveReview(details, me, teams);
      void bridge.reviewed(details.id);
      say(i18n()("review.left"));
      void bridge.refresh(true);
    } catch (e) {
      say(errorText(e));
    }
  };

  const runMenu = useEffectEvent((id: string) => {
    const actions: Record<string, () => void> = {
      find: openFind,
      "find-next": () => {
        stepFind(1);
      },
      "find-previous": () => {
        stepFind(-1);
      },
      "find-files": () => {
        setTab("diff");
        requestAnimationFrame(() => filterField.current?.focus());
      },
      overview: () => {
        setTab("overview");
      },
      diff: () => {
        setTab("diff");
      },
      wrap: () => {
        setWrap(!wrap);
      },
      whitespace: () => {
        setWhitespace(!whitespace);
      },
      "file-next": () => {
        setTab("diff");
        requestAnimationFrame(() => {
          stepToFile(1);
        });
      },
      "file-previous": () => {
        setTab("diff");
        requestAnimationFrame(() => {
          stepToFile(-1);
        });
      },
      "toggle-viewed": toggleViewedAtTop,
      shortcuts: () => {
        setShortcuts(true);
      },
      "next-file": goToNextFile,
      "next-comment": () => {
        step(1);
      },
      "previous-comment": () => {
        step(-1);
      },
      "ai-review": () => void runReview(),
      submit: () => {
        setSubmitting(true);
      },
      merge: () => {
        setMergeMenu(true);
      },
      commits: () => {
        setTab("diff");
        requestAnimationFrame(() => {
          setRangeMenu(true);
        });
      },
      ...pull.menu,
      "open-github": () => {
        if (details) void bridge.openUrl(details.url);
      },
      leave: () => void leave(),
    };
    actions[id]?.();
  });
  useEffect(() => {
    const off = bridge.on<string>("menu", (id) => {
      runMenu(id);
    });
    const keys: Record<string, string> = {
      "1": "overview",
      "2": "diff",
      f: "find",
      "shift+f": "find-files",
      g: "find-next",
      "shift+g": "find-previous",
      ",": "settings",
      q: "quit",
    };
    const onKey = (e: KeyboardEvent) => {
      const id = keys[`${e.shiftKey ? "shift+" : ""}${e.key.toLowerCase()}`];
      if (isMac || !id || !e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (id === "settings") void bridge.openSettings();
      else if (id === "quit") void bridge.quit();
      else runMenu(id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, []);
  const isOpen = details?.state === "OPEN";
  const allowed = {
    "find-next": findMatches.length > 0,
    "find-previous": findMatches.length > 0,
    "file-next": Boolean(files?.length),
    "file-previous": Boolean(files?.length),
    "toggle-viewed": tab === "diff" && Boolean(files?.length),
    "next-file": Boolean(files?.length),
    "next-comment": stops.length > 0,
    "previous-comment": stops.length > 0,
    "ai-review": Boolean(ai && details && files && !reviewing),
    submit: isOpen,
    merge: canMerge,
    commits: Boolean(pull.commits?.commits.length),
    ...pull.allowed,
    "open-github": Boolean(details),
    leave: canLeave,
  };
  const allowedKey = Object.entries(allowed)
    .map(([id, on]) => `${id}=${on}`)
    .join(" ");
  useEffect(() => {
    const items = Object.fromEntries(
      allowedKey.split(" ").map((pair) => [pair.slice(0, pair.lastIndexOf("=")), pair.endsWith("=true")]),
    );
    void bridge.menuState(items).catch(() => {});
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
      <header
        data-tauri-drag-region
        className={cn(
          "@container relative z-10 flex shrink-0 items-center justify-between gap-3 bg-background pr-2.5 transition-shadow duration-(--duration)",
          isMac ? "h-(--toolbar-h) pl-(--traffic-lights-inset)" : "h-11 pl-2",
          scrolled && "shadow-[0_1px_0_var(--separator)]",
        )}
      >
        <div ref={leadingRef} data-tauri-drag-region className="flex shrink-0 items-center gap-2">
          {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- its tabs take the focus, one at a time (the roving tabindex of WAI-ARIA's tabs pattern), not the list */}
          <div
            role="tablist"
            onKeyDown={tabKeys}
            aria-label={t("review.view")}
            className="relative isolate flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill p-0.5"
          >
            <SlidingPill
              selected={tab}
              className="rounded-full bg-(--toolbar-segment-bg) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)]"
            />
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
                onClick={() => {
                  setTab(value);
                }}
                className="flex h-6 cursor-default items-center gap-1.5 rounded-full px-3 text-body text-foreground focus-ring transition-colors duration-(--duration-fast) outline-none hover:not-aria-selected:bg-(--fill-control-hover)"
              >
                {label}
                <span className="min-w-3.5 text-center text-subheadline text-muted-foreground tabular-nums @max-[860px]:hidden">
                  {count === undefined ? <Skeleton className="h-3 w-3.5" /> : count || null}
                </span>
              </button>
            ))}
          </div>
          <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
            <RangePicker
              pull={{
                ...pull,
                setRange: (commits) => {
                  pull.setRange(commits);
                  setTab("diff");
                },
              }}
              className={TOOL}
              open={rangeMenu}
              onOpenChange={setRangeMenu}
            />
          </div>
          {stack ? <StackMenu stack={stack} className={TOOL} onPick={(other) => void goTo(visitOf(other))} /> : null}
        </div>

        <div
          data-tauri-drag-region
          style={titleBox ?? undefined}
          className={cn(
            "absolute inset-y-0 flex flex-col items-center justify-center gap-px text-center",
            !titleBox && "invisible",
          )}
        >
          {details ? (
            <>
              <div data-tauri-drag-region className="flex max-w-full items-center gap-1.5">
                {isOpen ? null : <PullState details={details} className="h-4 px-1.5" />}
                <h1 data-tauri-drag-region className="min-w-0 truncate text-headline font-bold" title={details.title}>
                  {details.title}
                </h1>
              </div>
              {notice ? (
                <output className="block max-w-full animate-in truncate text-subheadline text-foreground duration-(--duration) fade-in-0 motion-reduce:animate-none">
                  {notice}
                </output>
              ) : (
                <p
                  data-tauri-drag-region
                  className="max-w-full truncate text-subheadline text-muted-foreground @max-[1280px]:hidden"
                >
                  {repo} #{number} · {firstName(details.author, t)} ·{" "}
                  <span data-tauri-drag-region className="font-mono">
                    {details.headRefName}
                  </span>
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

        <div
          ref={trailingRef}
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-end gap-1 @max-[520px]:relative @max-[520px]:min-w-0 @max-[520px]:shrink @max-[520px]:justify-start @max-[520px]:overflow-x-auto"
        >
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
              <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
                <ToggleGroup
                  value={[diffStyle]}
                  onValueChange={(v: string[]) => {
                    const style = STYLES.find((s) => s === v[0]);
                    if (style) setDiffStyle(style);
                  }}
                  spacing={0}
                  aria-label={t("review.layout")}
                  className="h-full rounded-full"
                >
                  {(
                    [
                      ["split", t("review.sideBySide"), Columns2],
                      ["unified", t("review.oneColumn"), Rows2],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <Tooltip key={value}>
                      <TooltipTrigger
                        render={
                          <ToggleGroupItem
                            value={value}
                            aria-label={label}
                            className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-foreground")}
                          />
                        }
                      >
                        <Icon />
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </ToggleGroup>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-primary")}
                        aria-pressed={wrap}
                        aria-label={t("review.wrap")}
                        onClick={() => {
                          setWrap(!wrap);
                        }}
                      />
                    }
                  >
                    <WrapText />
                  </TooltipTrigger>
                  <TooltipContent>{t("review.wrapTip")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(TOOL_ICON, "aria-pressed:bg-transparent aria-pressed:text-primary")}
                        aria-pressed={whitespace}
                        aria-label={t("diff.hideWhitespace")}
                        onClick={() => {
                          setWhitespace(!whitespace);
                        }}
                      />
                    }
                  >
                    <Pilcrow />
                  </TooltipTrigger>
                  <TooltipContent>{t("diff.hideWhitespaceTip")}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {(config?.actions.length && details && me) ||
            (ai && details) ||
            canMerge ||
            (details?.viewerCanUpdate && isOpen && details.isDraft) ? (
              <div className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill">
                {config?.actions.length && details && me ? (
                  <>
                    <div className="contents @max-[1600px]:hidden">
                      <ActionButtons
                        actions={config.actions}
                        className={TOOL}
                        pr={{
                          number: details.number,
                          repo,
                          title: details.title,
                          url: details.url,
                          author: details.author?.login ?? "",
                          me,
                        }}
                        onResult={actionResult}
                      />
                    </div>
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(TOOL_ICON, "hidden @max-[1600px]:inline-flex")}
                                  aria-label={t("review.actions")}
                                />
                              }
                            />
                          }
                        >
                          <Zap />
                        </TooltipTrigger>
                        <TooltipContent>{t("review.actions")}</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <ActionMenuItems
                          actions={config.actions}
                          pr={{
                            number: details.number,
                            repo,
                            title: details.title,
                            url: details.url,
                            author: details.author?.login ?? "",
                            me,
                          }}
                          onResult={actionResult}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : null}
                {ai && details ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          className={cn(TOOL, "@max-[1360px]:w-(--toolbar-item-h) @max-[1360px]:px-0")}
                          onClick={reviewing ? stopAiReview : () => void runReview()}
                          disabled={!reviewing && !files}
                        />
                      }
                    >
                      {reviewing ? <Square className="size-3 fill-current" /> : <Sparkles />}
                      <span className="@max-[1360px]:sr-only">
                        {reviewing ? t("review.stop") : current ? t("review.reviewAgain") : t("review.aiReview")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {reviewing
                        ? t("review.stopReview")
                        : aiProblemNow
                          ? aiProblemNow.title
                          : current
                            ? t("review.reviewAgainTip")
                            : t("review.aiReviewTip")}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {details && details.viewerCanUpdate && isOpen && details.isDraft ? (
                  <Button
                    variant="ghost"
                    className={TOOL}
                    onClick={() => void pull.actions.ready()}
                    disabled={pull.busy === "ready"}
                  >
                    {t("review.markReady")}
                  </Button>
                ) : null}
                {canMerge && details ? (
                  <DropdownMenu open={mergeMenu} onOpenChange={setMergeMenu}>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" className={cn(TOOL, "gap-1 @max-[1360px]:px-2")} />}
                    >
                      <GitMerge /> <span className="@max-[1360px]:sr-only">{t("review.merge")}</span>
                      <ChevronDown className="size-3 opacity-70" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <MergeMenuItems
                        details={details}
                        pull={pull}
                        onDetails={() => {
                          setTab("overview");
                        }}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : null}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(TOOL_ICON, "bg-fill")}
                          aria-label={t("review.more")}
                        />
                      }
                    />
                  }
                >
                  <MoreHorizontal />
                </TooltipTrigger>
                <TooltipContent>{t("review.more")}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    if (details) void bridge.openUrl(details.url);
                  }}
                >
                  {t("review.openOnGitHub")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (details)
                      void copyText(details.url).then(() => {
                        say(i18n()("review.linkCopied"));
                      });
                  }}
                >
                  {t("review.copyLink")}
                </DropdownMenuItem>
                <PullMenuItems pull={pull} details={details} />
                <DropdownMenuItem
                  onClick={() => {
                    setShortcuts(true);
                  }}
                >
                  {t("diff.shortcuts")}
                </DropdownMenuItem>
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
                  void bridge.reviewed(details.id);
                  say(i18n()("review.reviewSent"));
                  void changed();
                }}
              />
            ) : null}
            {target.queue ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      className={cn(TOOL, "gap-1 bg-fill @max-[1360px]:w-(--toolbar-item-h) @max-[1360px]:px-0")}
                      aria-label={t("review.markDone")}
                      aria-keyshortcuts="E"
                      onClick={() => void markDone()}
                    />
                  }
                >
                  <Check />
                  <span className="@max-[1360px]:sr-only">{t("review.markDone")}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  <span className="block font-semibold">
                    {t("review.markDone")} <Kbd>E</Kbd>
                  </span>
                  <span className="block">{t("review.markDoneTip", { queue: queueLabel })}</span>
                </TooltipContent>
              </Tooltip>
            ) : null}
            {nextPull || previous || upStack ? (
              <div
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a capsule of toolbar buttons, not a form's fieldset (with its legend and min-inline-size)
                role="group"
                aria-label={t("review.pullNavigation")}
                className="flex h-(--toolbar-item-h) shrink-0 items-center rounded-full bg-fill"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={TOOL_ICON}
                        disabled={!previous}
                        aria-label={
                          previous
                            ? t("review.backToLabel", { number: String(previous.pr.number), title: previous.pr.title })
                            : t("review.back")
                        }
                        aria-keyshortcuts="Meta+["
                        onClick={() => void goBack()}
                      />
                    }
                  >
                    <ChevronLeft />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <span className="block font-semibold">
                      {t("review.back")} <Kbd>{shortcut("[", ["cmd"])}</Kbd>
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
                        aria-disabled={!nextPull && !upStack}
                        aria-label={
                          upStack
                            ? t("review.nextInStackLabel", { number: String(upStack.number), title: upStack.title })
                            : nextPull
                              ? t("review.nextPullLabel", {
                                  queue: queueName,
                                  number: String(nextPull.pr.number),
                                  title: nextPull.pr.title,
                                })
                              : t("review.nextPull")
                        }
                        aria-keyshortcuts="Meta+]"
                        onClick={() => void nextInQueue()}
                      />
                    }
                  >
                    <span className="@max-[1360px]:sr-only">{t("review.nextPull")}</span>
                    <ChevronRight />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <span className="block font-semibold">
                      {upStack
                        ? t("review.nextInStack")
                        : queueName
                          ? t("review.nextPullIn", { queue: queueName })
                          : t("review.nextPull")}{" "}
                      <Kbd>{shortcut("]", ["cmd"])}</Kbd>
                    </span>
                    <span className="block truncate">
                      {upStack
                        ? `#${upStack.number} · ${upStack.title}`
                        : nextPull
                          ? `#${nextPull.pr.number} · ${nextPull.pr.title}`
                          : t("review.queueDone", { queue: queueName || t("review.theQueue") })}
                    </span>
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <ConversationProvider value={talk.api}>
        <main
          className="relative flex min-h-0 flex-1 flex-col [view-transition-name:page]"
          onScrollCapture={(e) => {
            setScrolled(e.target instanceof Element && e.target.scrollTop > 0);
          }}
        >
          {newChanges ? (
            <output className="absolute top-2 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 animate-in items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-3 text-callout shadow-(--shadow-menu) duration-(--duration) fade-in-0 slide-in-from-top-2 motion-reduce:animate-none">
              <GitCommitHorizontal className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t("review.newChanges")}</span>
              <Button className="shrink-0 rounded-full" onClick={() => void update()} disabled={updating}>
                {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t("review.update")}
              </Button>
            </output>
          ) : null}
          <div
            role="tabpanel"
            id="panel-overview"
            aria-labelledby="tab-overview"
            hidden={tab !== "overview"}
            className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto bg-muted/30"
          >
            {details ? (
              <Overview
                config={config}
                details={details}
                conversation={talk.conversation}
                threads={conversations}
                review={current}
                reviewing={Boolean(reviewing)}
                reviewError={reviewError}
                onStopReview={stopAiReview}
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
                onOpenRange={(commits) => {
                  pull.setRange(commits);
                  setTab("diff");
                  requestAnimationFrame(() => diffs.current?.scrollToTop());
                }}
                stack={stack}
                onPickStack={(other) => void goTo(visitOf(other))}
                hasFile={(path) => Boolean(files?.some((f) => f.path === path))}
                say={say}
              />
            ) : (
              <div
                className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]"
                aria-busy="true"
                aria-label={t("review.loading")}
              >
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

          <div
            role="tabpanel"
            id="panel-diff"
            aria-labelledby="tab-diff"
            hidden={tab !== "diff"}
            className="flex min-h-0 flex-1"
          >
            <aside className="flex w-72 shrink-0 flex-col border-r" aria-label={t("review.files")}>
              <div className="flex flex-col gap-2 border-b p-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    ref={filterField}
                    type="search"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      requestAnimationFrame(() => diffs.current?.scrollToTop());
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && filter) {
                        e.preventDefault();
                        setFilter("");
                      }
                    }}
                    placeholder={t("review.filterFilesPlaceholder")}
                    aria-label={t("review.filterFiles")}
                    className="rounded-full pr-6 pl-7 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
                  />
                  {filter ? (
                    <button
                      type="button"
                      aria-label={t("review.clear")}
                      onClick={() => {
                        setFilter("");
                      }}
                      className="group/clear absolute top-1/2 right-0.5 grid size-6 -translate-y-1/2 cursor-default place-items-center rounded-full focus-ring outline-none"
                    >
                      <span className="grid size-3.5 place-items-center rounded-full bg-muted-foreground/60 text-background transition-colors duration-(--duration-fast) group-hover/clear:bg-muted-foreground">
                        <X className="size-2.5" strokeWidth={3} aria-hidden />
                      </span>
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-subheadline text-muted-foreground">
                  <Progress
                    value={inPart.length > 0 ? (viewedCount / inPart.length) * 100 : 0}
                    className="flex-1"
                    aria-label={t("review.filesViewed")}
                  />
                  <span className="tabular-nums">
                    {t("review.viewedOf", { viewed: viewedCount, total: inPart.length })}
                  </span>
                </div>
                <label className="flex items-center gap-1.5 text-body">
                  <Checkbox checked={hideViewed} onCheckedChange={setHideViewed} className="size-3.5" />{" "}
                  {t("review.hideViewed")}
                </label>
              </div>
              <FileTree
                files={shownFiles ? visible : null}
                flat={Boolean(filter.trim())}
                picked={picked}
                isViewed={isViewed}
                comments={(path) => threadsByPath.get(path)?.filter((th) => !th.resolved).length ?? 0}
                onPick={(path) => {
                  setPicked(path);
                  diffs.current?.scrollToFile(path);
                }}
              />
            </aside>

            <div className="relative min-w-0 flex-1 bg-muted/30">
              {find ? (
                <FindBar
                  key={findFocus}
                  query={find.query}
                  total={findMatches.length}
                  at={find.at}
                  onQuery={(query) => {
                    const matches = findInPatches(
                      visible.map((f) => ({ path: f.path, patch: f.patch })),
                      query,
                    );
                    showFound(query, matches, matches.length > 0 ? 0 : -1);
                  }}
                  onStep={stepFind}
                  onClose={closeFind}
                />
              ) : null}
              <RangeBanner
                pull={pull}
                below={Boolean(newChanges)}
                loading={Boolean(pull.range && !ranged.files && !ranged.error)}
                error={ranged.error}
              />
              {shownFiles ? (
                visible.length > 0 ? (
                  <Diffs
                    ref={diffs}
                    pull={prId}
                    files={visible}
                    threads={olderRange ? new Map<string, Thread[]>() : threadsByPath}
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
                        ? async (path, lines, question, earlier, run) => {
                            if (!(await ensureAi(ai)))
                              throw new Error(
                                i18n()("shared.aiNotReady", { provider: PROVIDERS[ai.ai.provider!].name }),
                              );
                            return askAboutLines(
                              ai,
                              details,
                              files,
                              path,
                              Math.min(lines.start, lines.end),
                              Math.max(lines.start, lines.end),
                              lines.endSide ?? lines.side ?? "additions",
                              question,
                              earlier,
                              run,
                            );
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
                  <p className="p-10 text-center text-body text-muted-foreground">
                    {chosen.length > 0 && inPart.length === 0
                      ? t("review.noFilesIn", { filters: chosen.map((f) => f.name).join(" + ") })
                      : t("review.noFilesMatch")}
                  </p>
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
                  onToggle={(id) => {
                    choose(toggled(chosenIds, id));
                  }}
                  onNextFile={goToNextFile}
                >
                  <CommentNav stops={stops} stop={stop} onStep={step} />
                </FilterBar>
              ) : null}
            </div>
          </div>
        </main>
      </ConversationProvider>
      <Shortcuts open={shortcuts} onOpenChange={setShortcuts} />
    </div>
  );
}
