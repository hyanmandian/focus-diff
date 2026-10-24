// A pull request inside the panel: what it is, where it stands, what was said, what changed, and
// the actions that fit it, so reviewing doesn't start with opening GitHub.

import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleX,
  Code2,
  ExternalLink,
  GitMerge,
  GitPullRequestDraft,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  UserMinus,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { bridge } from "@/lib/bridge";
import { PROVIDERS, summarize } from "@/lib/ai";
import type { Config, Queue } from "@/lib/config";
import { ago, firstName } from "@/lib/copy";
import { comment, leaveReview, loadDetails, markReady, merge, review, type Details as PullDetails } from "@/lib/details";
import type { Actor, Item } from "@/lib/engine";
import { sanitize } from "@/lib/sanitize";
import { refresh } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AiAnswer } from "@/shared/AiAnswer";

function Person({ actor, className }: { actor: Actor; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {actor?.avatarUrl ? <AvatarImage src={actor.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-[9px]">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** GitHub's HTML, cleaned (sanitize.ts); links open in the browser. */
function Html({ html, className }: { html: string; className?: string }) {
  const clean = sanitize(html);
  if (!clean.trim()) return <p className="text-sm text-muted-foreground italic">No description.</p>;
  return (
    <div
      className={cn(
        "prose-sm text-[13px] leading-relaxed break-words",
        "[&_a]:text-unread [&_a]:underline-offset-2 hover:[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2",
        className,
      )}
      onClick={(e) => {
        const link = (e.target as Element).closest("a[href]");
        if (link) {
          e.preventDefault();
          void bridge.openUrl((link as HTMLAnchorElement).href);
        }
      }}
      // Sanitized above: an allowlist of tags and attributes, https links and GitHub images only.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

const CHECK_ICON = {
  success: { icon: CircleCheck, className: "text-success", label: "Passed" },
  failure: { icon: CircleX, className: "text-destructive", label: "Failed" },
  pending: { icon: CircleDot, className: "text-warning", label: "Running" },
  neutral: { icon: CircleMinus, className: "text-muted-foreground", label: "Skipped" },
} as const;

const REVIEW_STATE = {
  APPROVED: { label: "Approved", className: "text-success" },
  CHANGES_REQUESTED: { label: "Changes requested", className: "text-destructive" },
  COMMENTED: { label: "Commented", className: "text-muted-foreground" },
  PENDING: { label: "Not reviewed yet", className: "text-muted-foreground" },
  DISMISSED: { label: "Dismissed", className: "text-muted-foreground" },
} as const;

type Mode = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

function Composer({ details, initial, onDone, onCancel }: { details: PullDetails; initial: Mode; onDone: (message: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const own = details.viewerDidAuthor;
  const needsBody = mode !== "APPROVE";

  const submit = async () => {
    if (needsBody && !body.trim()) return setError(mode === "COMMENT" ? "Write a comment first." : "Say what needs to change.");
    setBusy(true);
    setError(null);
    try {
      if (mode === "COMMENT") await comment(details, body.trim());
      else await review(details, mode, body.trim());
      onDone(mode === "APPROVE" ? "Approved" : mode === "REQUEST_CHANGES" ? "Changes requested" : "Comment posted");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t bg-background/95 p-3">
      {!own ? (
        <ToggleGroup value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0] as Mode)} variant="outline" size="sm" aria-label="Kind of reply" className="w-full">
          <ToggleGroupItem value="COMMENT" className="flex-1">
            Comment
          </ToggleGroupItem>
          <ToggleGroupItem value="APPROVE" className="flex-1">
            Approve
          </ToggleGroupItem>
          <ToggleGroupItem value="REQUEST_CHANGES" className="flex-1">
            Request changes
          </ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      <label htmlFor={id} className="sr-only">
        {mode === "COMMENT" ? "Comment" : "Review comment"}
      </label>
      <Textarea
        id={id}
        ref={ref}
        rows={3}
        value={body}
        placeholder={mode === "APPROVE" ? "Optional note" : mode === "COMMENT" ? "Leave a comment" : "What needs to change?"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        className="resize-none text-[13px]"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">⌘ Enter to send</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant={mode === "REQUEST_CHANGES" ? "destructive" : "default"} onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {mode === "APPROVE" ? "Approve" : mode === "REQUEST_CHANGES" ? "Request changes" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

type Props = { item: Item; queue: Queue | undefined; me: string; config: Config | null; onBack: () => void; onOpenDiff: (item: Item) => void };

function Summary({ config, details }: { config: Config; details: PullDetails }) {
  const [state, setState] = useState<{ phase: "idle" | "busy" | "done" | "error"; text?: string }>({ phase: "idle" });
  const provider = config.ai.provider;
  if (!provider) return null;
  const run = async () => {
    setState({ phase: "busy" });
    try {
      setState({ phase: "done", text: await summarize(config, details) });
    } catch (e) {
      setState({ phase: "error", text: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section aria-labelledby="summary" className="rounded-xl border bg-muted/40 p-3" aria-busy={state.phase === "busy"}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-violet" aria-hidden />
        <h3 id="summary" className="text-xs font-semibold">
          Summary
        </h3>
        <span className="text-[11px] text-muted-foreground">by {PROVIDERS[provider].name}</span>
        {state.phase !== "busy" ? (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => void run()}>
            {state.phase === "idle" ? "Summarize" : "Again"}
          </Button>
        ) : (
          <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Thinking" />
        )}
      </div>
      {state.phase === "done" && state.text ? (
        <div className="mt-2">
          <AiAnswer text={state.text} />
        </div>
      ) : state.phase === "error" ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {state.text}
        </p>
      ) : state.phase === "busy" ? (
        <p className="mt-2 text-xs text-muted-foreground">Reading the diff… this can take a minute.</p>
      ) : null}
    </section>
  );
}

export function Details({ item, queue, me, config, onBack, onOpenDiff }: Props) {
  const { pr } = item;
  const [details, setDetails] = useState<PullDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<Mode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [method, setMethod] = useState<"squash" | "merge" | "rebase">("squash");

  const load = useCallback(async () => {
    try {
      const next = await loadDetails(pr.repository.nameWithOwner, pr.number);
      setDetails(next);
      setError(null);
      if (next.mergeMethods.length && !next.mergeMethods.includes(method)) setMethod(next.mergeMethods[0]!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pr.repository.nameWithOwner, pr.number, method]);

  useEffect(() => {
    void load();
    // Only when the pull request changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.id]);

  // Esc goes back to the list (the panel's own Esc closes it from there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !composer && !document.querySelector("[data-popup-open]")) {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [composer, onBack]);

  const done = (message: string) => {
    setComposer(null);
    setNotice(message);
    void load();
    void refresh(true);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const act = async (label: string, action: () => Promise<unknown>, message: string) => {
    setBusy(label);
    try {
      await action();
      done(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = details?.state === "OPEN";
  const mine = details?.viewerDidAuthor ?? pr.author?.login === me;
  const canMerge = open && mine && !details?.isDraft && details?.mergeable === "MERGEABLE" && details.mergeMethods.length > 0;
  const failing = details?.checks.filter((c) => c.state === "failure").length ?? 0;
  const running = details?.checks.filter((c) => c.state === "pending").length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 slide-in-from-right-4 duration-200 motion-reduce:animate-none">
      <div className="flex shrink-0 items-start gap-2 border-b px-2 py-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to the list">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="line-clamp-2 text-[13px] leading-snug font-semibold">{pr.title}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {pr.repository.nameWithOwner} #{pr.number} · {firstName(pr.author)}
            {details ? (
              <>
                {" · "}
                <span className="font-mono">{details.headRefName}</span> → <span className="font-mono">{details.baseRefName}</span>
              </>
            ) : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {details?.state === "MERGED" ? (
              <span className="flex items-center gap-1 text-violet">
                <GitMerge className="size-3.5" /> Merged
              </span>
            ) : details?.isDraft ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <GitPullRequestDraft className="size-3.5" /> Draft
              </span>
            ) : null}
            {details?.mergeable === "CONFLICTING" && open ? <span className="text-destructive">Conflicts with {details.baseRefName}</span> : null}
            {details ? (
              <span className="font-mono text-muted-foreground">
                <span className="text-success">+{details.additions}</span> <span className="text-destructive">−{details.deletions}</span> · {details.changedFiles} files
              </span>
            ) : null}
            {failing ? <span className="text-destructive">{failing} failing</span> : running ? <span className="text-warning">{running} running</span> : details?.checks.length ? <span className="text-success">Checks passed</span> : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void bridge.openUrl(pr.url)}>
              <ExternalLink /> Open on GitHub
            </DropdownMenuItem>
            {queue?.kind === "review" && details && open ? (
              <DropdownMenuItem onClick={() => void act("leave", () => leaveReview(details, me, item.viaTeams ?? []), "You left the review")}>
                <UserMinus /> Leave this review
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !details ? (
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList variant="line" className="mx-3 mt-1 shrink-0 justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="conversation">Conversation {details.entries.length ? <span className="text-muted-foreground tabular-nums">{details.entries.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="files">Files <span className="text-muted-foreground tabular-nums">{details.changedFiles}</span></TabsTrigger>
          </TabsList>
          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="overview" className="flex flex-col gap-5 p-4">
              {config ? <Summary config={config} details={details} /> : null}
              <Html html={details.html} />
              <section aria-labelledby="reviewers" className="flex flex-col gap-2">
                <h3 id="reviewers" className="text-xs font-semibold text-muted-foreground">
                  Reviewers
                </h3>
                {details.reviewers.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {details.reviewers.map(({ actor, state, team }) => (
                      <li key={`${actor?.login}${team ?? ""}`} className="flex items-center gap-2 text-[13px]">
                        {team ? <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-semibold">{team.slice(0, 2).toUpperCase()}</span> : <Person actor={actor} />}
                        <span className="truncate">{team ?? firstName(actor)}</span>
                        <span className={cn("ml-auto text-xs", REVIEW_STATE[state]?.className)}>{REVIEW_STATE[state]?.label ?? state}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Nobody asked yet.</p>
                )}
              </section>
              {details.checks.length ? (
                <section aria-labelledby="checks" className="flex flex-col gap-2">
                  <h3 id="checks" className="text-xs font-semibold text-muted-foreground">
                    Checks
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {details.checks.slice(0, 12).map((check) => {
                      const s = CHECK_ICON[check.state];
                      const row = (
                        <>
                          <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-label={s.label} />
                          <span className="truncate">{check.name}</span>
                        </>
                      );
                      return (
                        <li key={check.name} className="text-[13px]">
                          {check.url?.startsWith("https://") ? (
                            <button type="button" className="flex w-full items-center gap-2 rounded text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => void bridge.openUrl(check.url!)}>
                              {row}
                            </button>
                          ) : (
                            <span className="flex items-center gap-2">{row}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {details.checks.length > 12 ? <p className="text-xs text-muted-foreground">and {details.checks.length - 12} more</p> : null}
                </section>
              ) : null}
            </TabsContent>
            <TabsContent value="conversation" className="flex flex-col gap-4 p-4">
              {details.entries.length ? (
                details.entries.map((entry) => (
                  <article key={entry.id} className="flex gap-2.5">
                    <Person actor={entry.author} className="mt-0.5 size-6" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{firstName(entry.author)}</span>
                        {entry.kind === "review" ? <span className={cn(" ml-1", REVIEW_STATE[entry.state as keyof typeof REVIEW_STATE]?.className)}>{REVIEW_STATE[entry.state as keyof typeof REVIEW_STATE]?.label.toLowerCase()}</span> : null} · {ago(Date.parse(entry.at))}
                      </p>
                      {entry.html.trim() ? <Html html={entry.html} className="mt-1" /> : null}
                      {entry.kind === "review"
                        ? entry.comments.map((c) => (
                            <div key={c.id} className="mt-2 rounded-lg border p-2">
                              <p className="truncate font-mono text-[11px] text-muted-foreground">
                                {c.path}
                                {c.line ? `:${c.line}` : ""}
                              </p>
                              <Html html={c.html} className="mt-1" />
                            </div>
                          ))
                        : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No conversation yet.</p>
              )}
            </TabsContent>
            <TabsContent value="files" className="p-2">
              <ul className="flex flex-col">
                {details.files.map((f) => {
                  const slash = f.path.lastIndexOf("/");
                  return (
                    <li key={f.path} className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-foreground/5">
                      <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>
                        <span className="text-muted-foreground">{f.path.slice(0, slash + 1)}</span>
                        {f.path.slice(slash + 1)}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">
                        <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {details.changedFiles > details.files.length ? <p className="px-2 py-2 text-xs text-muted-foreground">{details.changedFiles - details.files.length} more in the diff</p> : null}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      )}

      {notice ? (
        <p className="shrink-0 border-t px-3 py-2 text-center text-xs font-medium" role="status">
          {notice}
        </p>
      ) : null}

      {details && composer ? (
        <Composer details={details} initial={composer} onDone={done} onCancel={() => setComposer(null)} />
      ) : details ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t p-2">
          <Button variant="outline" size="sm" onClick={() => onOpenDiff(item)}>
            <Code2 /> Open diff
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            {open && !mine ? (
              <>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Comment" onClick={() => setComposer("COMMENT")} />}>
                    <MessageSquare />
                  </TooltipTrigger>
                  <TooltipContent>Comment</TooltipContent>
                </Tooltip>
                <Button variant="outline" size="sm" onClick={() => setComposer("REQUEST_CHANGES")}>
                  Request changes
                </Button>
                <Button size="sm" onClick={() => void act("approve", () => review(details, "APPROVE", ""), "Approved")} disabled={busy !== null}>
                  {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
                </Button>
              </>
            ) : null}
            {open && mine ? (
              <>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Comment" onClick={() => setComposer("COMMENT")} />}>
                    <MessageSquare />
                  </TooltipTrigger>
                  <TooltipContent>Comment</TooltipContent>
                </Tooltip>
                {details.isDraft ? (
                  <Button size="sm" onClick={() => void act("ready", () => markReady(details), "Ready for review")} disabled={busy !== null}>
                    {busy === "ready" ? <Loader2 className="animate-spin" /> : null} Ready for review
                  </Button>
                ) : canMerge ? (
                  <div className="flex items-center">
                    <Button size="sm" className="rounded-r-none" onClick={() => void act("merge", () => merge(details, method), "Merged")} disabled={busy !== null}>
                      {busy === "merge" ? <Loader2 className="animate-spin" /> : <GitMerge />} {method === "squash" ? "Squash and merge" : method === "rebase" ? "Rebase and merge" : "Merge"}
                    </Button>
                    {details.mergeMethods.length > 1 ? (
                      <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                        <SelectTrigger size="sm" className="rounded-l-none border-l-0 px-1.5" aria-label="Merge method">
                          <SelectValue>{() => null}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end">
                          {details.mergeMethods.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m === "squash" ? "Squash and merge" : m === "rebase" ? "Rebase and merge" : "Create a merge commit"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
