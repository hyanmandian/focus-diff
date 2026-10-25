// The review window, where a pull request is reviewed: its files and diffs with their
// conversations, the overview and conversation in a side pane, and the review itself. Pending
// comments and what's been viewed are kept on this machine, so closing the window loses nothing.

import { Columns2, ExternalLink, GitMerge, Loader2, MoreHorizontal, PanelRight, Rows2, Search, Send, Sparkles, UserMinus, WrapText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PROVIDERS, review as aiReview, type AiReview, type Finding } from "@/lib/ai";
import { bridge } from "@/lib/bridge";
import { inFilter, loadConfig, type Config } from "@/lib/config";
import { firstName } from "@/lib/copy";
import { leaveReview, loadDetails, markReady, merge, type Details } from "@/lib/details";
import { commentNow, loadFiles, loadThreads, reply, setResolved, submitReview, type Draft, type ReviewFile, type Thread } from "@/lib/review";
import { useTheme } from "@/lib/theme";
import { ActionButtons } from "@/shared/Actions";
import { cn } from "@/lib/utils";
import { Diffs, type DiffsHandle } from "./Diffs";
import { Inspector } from "./Inspector";

const params = new URLSearchParams(location.search);
const prId = params.get("id") ?? "";
const repo = params.get("repo") ?? "";
const number = Number(params.get("number"));
/** The teams its review was asked of on your behalf ("org/slug"), for leaving the review. */
const teams = (params.get("teams") ?? "").split(",").filter(Boolean);
const isMac = navigator.userAgent.includes("Mac");

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

function SubmitReview({ details, drafts, onSubmitted }: { details: Details; drafts: Draft[]; onSubmitted: () => void }) {
  const own = details.viewerDidAuthor;
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<Event>("COMMENT");
  const [body, setBody] = useState("");
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
      <PopoverTrigger render={<Button size="sm" />}>
        <Send /> Submit review
        {drafts.length ? <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 tabular-nums">{drafts.length}</Badge> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Finish your review</p>
          <Textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment"
            aria-label="Review comment"
            className="resize-y text-[13px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <ToggleGroup value={[event]} onValueChange={(v: string[]) => v[0] && setEvent(v[0] as Event)} variant="outline" size="sm" aria-label="Kind of review" className="w-full">
            <ToggleGroupItem value="COMMENT" className="flex-1">
              Comment
            </ToggleGroupItem>
            <ToggleGroupItem value="APPROVE" className="flex-1" disabled={own}>
              Approve
            </ToggleGroupItem>
            <ToggleGroupItem value="REQUEST_CHANGES" className="flex-1" disabled={own}>
              Request changes
            </ToggleGroupItem>
          </ToggleGroup>
          {own ? <p className="text-xs text-muted-foreground">It's your pull request: you can comment, not approve.</p> : null}
          {drafts.length ? <p className="text-xs text-muted-foreground">Sends {drafts.length} pending {drafts.length === 1 ? "comment" : "comments"} with it.</p> : null}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button onClick={() => void submit()} disabled={busy} variant={event === "REQUEST_CHANGES" ? "destructive" : "default"}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {event === "APPROVE" ? "Approve" : event === "REQUEST_CHANGES" ? "Request changes" : "Comment"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function Review() {
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
  const [inspector, setInspector] = usePersisted("inspector", true);
  // The part being reviewed, remembered per repository: its files are what shows.
  const [part, setPart] = usePersisted(`filter:${repo}`, "");
  // The AI review of this pull request's current head, kept until it changes.
  const [reviewed, setReviewed] = usePersisted<{ head: string; review: AiReview } | null>(`ai-review:${prId}`, null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  useTheme(config?.theme);
  const dark = useDark(config);
  const diffs = useRef<DiffsHandle>(null);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await loadDetails(repo, number);
      setDetails(d);
      const [f, t] = await Promise.all([loadFiles(d), loadThreads(d)]);
      setFiles(f);
      setThreads(t);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
    if (details) setThreads(await loadThreads(details));
  }, [details]);

  const isViewed = useCallback((f: ReviewFile) => viewed[f.path] === hash(f.patch), [viewed]);
  const active = config?.filters.find((f) => f.id === part) ?? null;
  const inPart = useMemo(() => (files ?? []).filter((f) => !active || inFilter(active, f.path)), [files, active]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return inPart.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!hideViewed || viewed[f.path] !== hash(f.patch)));
  }, [inPart, filter, hideViewed, viewed]);
  const viewedCount = inPart.filter(isViewed).length;

  const threadsByPath = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) map.set(t.path, [...(map.get(t.path) ?? []), t]);
    return map;
  }, [threads]);

  if (error && !details) {
    return (
      <div className="grid h-screen place-items-center p-10 text-center">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const canMerge = details && details.viewerDidAuthor && details.state === "OPEN" && !details.isDraft && details.mergeable === "MERGEABLE" && details.mergeMethods.length > 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header data-tauri-drag-region className={cn("flex h-11 shrink-0 items-center gap-3 border-b pr-3", isMac ? "pl-[84px]" : "pl-3")}>
        <div data-tauri-drag-region className="min-w-0 flex-1">
          {details ? (
            <p data-tauri-drag-region className="truncate text-[13px]">
              <span className="font-semibold">{details.title}</span>
              <span className="text-muted-foreground">
                {" "}
                · {repo} #{number} · {firstName(details.author)} · <span className="font-mono">{details.headRefName}</span>
              </span>
            </p>
          ) : (
            <Skeleton className="h-4 w-80" />
          )}
        </div>
        <ToggleGroup value={[diffStyle]} onValueChange={(v: string[]) => v[0] && setDiffStyle(v[0] as "split" | "unified")} variant="outline" size="sm" aria-label="Layout">
          <ToggleGroupItem value="split" aria-label="Side by side">
            <Columns2 />
          </ToggleGroupItem>
          <ToggleGroupItem value="unified" aria-label="One column">
            <Rows2 />
          </ToggleGroupItem>
        </ToggleGroup>
        <Tooltip>
          <TooltipTrigger render={<Button variant={wrap ? "secondary" : "ghost"} size="icon-sm" aria-pressed={wrap} aria-label="Wrap long lines" onClick={() => setWrap(!wrap)} />}>
            <WrapText />
          </TooltipTrigger>
          <TooltipContent>Wrap long lines</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant={inspector ? "secondary" : "ghost"} size="icon-sm" aria-pressed={inspector} aria-label="Overview and conversation" onClick={() => setInspector(!inspector)} />}>
            <PanelRight />
          </TooltipTrigger>
          <TooltipContent>Overview and conversation</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => details && void bridge.openUrl(details.url)}>
              <ExternalLink /> Open on GitHub
            </DropdownMenuItem>
            {details && me && !details.viewerDidAuthor && details.state === "OPEN" ? (
              <DropdownMenuItem
                onClick={() =>
                  void leaveReview(details, me, teams)
                    .then(() => {
                      say("You left the review");
                      void bridge.refresh(true);
                    })
                    .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
                }
              >
                <UserMinus /> Leave this review
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <ActionButtons
          actions={config?.actions ?? []}
          pr={details && me ? { number: details.number, repo, title: details.title, url: details.url, author: details.author?.login ?? "", me } : null}
          onResult={(message, ok) => {
            say(message);
            if (ok) {
              void bridge.refresh(true);
              void load();
            }
          }}
        />
        {ai && details ? (
          <Button size="sm" variant="outline" onClick={() => void runReview()} disabled={Boolean(reviewing) || !files}>
            {reviewing ? <Loader2 className="animate-spin" /> : <Sparkles />} {current ? "Review again" : "AI review"}
          </Button>
        ) : null}
        {details && details.viewerDidAuthor && details.state === "OPEN" && details.isDraft ? (
          <Button
            size="sm"
            variant="outline"
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
            Ready for review
          </Button>
        ) : null}
        {canMerge ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void merge(details, details.mergeMethods[0]!)
                .then(() => {
                  say("Merged");
                  void bridge.refresh(true);
                  void load();
                })
                .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
            }
          >
            <GitMerge /> Merge
          </Button>
        ) : null}
        {details && details.state === "OPEN" ? (
          <SubmitReview
            details={details}
            drafts={drafts}
            onSubmitted={() => {
              setDrafts([]);
              say("Review sent");
              void changed();
            }}
          />
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r" aria-label="Files">
          <div className="flex flex-col gap-2 border-b p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files" className="h-8 pl-8 text-[13px]" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Progress value={inPart.length ? (viewedCount / inPart.length) * 100 : 0} className="flex-1" aria-label="Files viewed" />
              <span className="tabular-nums">
                {viewedCount}/{inPart.length} viewed
              </span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={hideViewed} onCheckedChange={setHideViewed} /> Hide viewed files
            </label>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col p-1.5">
              {visible.map((f) => {
                const slash = f.path.lastIndexOf("/");
                const comments = threadsByPath.get(f.path)?.filter((t) => !t.resolved).length ?? 0;
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", isViewed(f) && "text-muted-foreground")}
                      onClick={() => diffs.current?.scrollToFile(f.path)}
                      title={f.path}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono">
                        <span className="text-muted-foreground">{f.path.slice(0, slash + 1)}</span>
                        {f.path.slice(slash + 1)}
                      </span>
                      {comments ? <span className="text-[11px] text-unread tabular-nums" aria-label={`${comments} open conversations`}>{comments}</span> : null}
                      <span className="shrink-0 font-mono text-[11px] tabular-nums">
                        <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </aside>

        <main className="relative min-w-0 flex-1 bg-muted/30">
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
                isViewed={isViewed}
                diffStyle={diffStyle}
                wrap={wrap}
                dark={dark}
                onViewed={(f, v) => setViewed((m) => (v ? { ...m, [f.path]: hash(f.patch) } : Object.fromEntries(Object.entries(m).filter(([p]) => p !== f.path))))}
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
              <p className="p-10 text-center text-sm text-muted-foreground">{active && !inPart.length ? `No files in ${active.name}.` : "No files match."}</p>
            )
          ) : (
            <div className="flex flex-col gap-3 p-3" aria-busy="true" aria-label="Loading files">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          )}
          {files && config?.filters.length ? (
            // Focus Diff's bar: the parts of the pull request, and how much of it is in view.
            <div role="group" aria-label="Review one part" className="absolute inset-x-4 bottom-4 z-20 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-xl border bg-popover/95 p-1 shadow-xl backdrop-blur [scrollbar-width:none]">
              {[{ id: "", name: "All", count: files.length }, ...config.filters.map((f) => ({ id: f.id, name: f.name, count: files.filter((x) => inFilter(f, x.path)).length }))].map((chip) => (
                <button
                  key={chip.id || "all"}
                  type="button"
                  aria-pressed={(active?.id ?? "") === chip.id}
                  onClick={() => setPart(chip.id)}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-lg pr-1.5 pl-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    (active?.id ?? "") === chip.id ? "bg-unread text-white" : "hover:bg-foreground/6",
                    chip.count === 0 && (active?.id ?? "") !== chip.id && "text-muted-foreground",
                  )}
                >
                  {chip.name}
                  <span className={cn("rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums", (active?.id ?? "") === chip.id ? "bg-black/16" : "bg-muted text-muted-foreground")}>{chip.count}</span>
                </button>
              ))}
              <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
              <span className="shrink-0 pr-2 font-mono text-[11px] whitespace-nowrap tabular-nums" aria-label="Lines in view">
                <span className="text-success">+{inPart.reduce((n, f) => n + f.additions, 0)}</span> <span className="text-destructive">−{inPart.reduce((n, f) => n + f.deletions, 0)}</span>
              </span>
            </div>
          ) : null}
        </main>

        {inspector ? (
          <aside className="flex w-[380px] shrink-0 flex-col border-l" aria-label="Overview and conversation">
            {details ? (
              <Inspector config={config} details={details} review={current} reviewing={Boolean(reviewing)} reviewError={reviewError} />
            ) : (
              <div className="flex flex-col gap-3 p-4" aria-busy="true">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-24" />
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {notice ? (
        <div role="status" className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-background shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
