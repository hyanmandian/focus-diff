// The review window's Overview tab: the pull request's description and conversation, with the AI,
// reviewers and checks beside them.

import { ArrowDownToLine, CircleCheck, CircleDot, CircleMinus, CircleX, Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PROVIDERS, type AiReview } from "@/lib/ai";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import type { Config } from "@/lib/config";
import { ago, firstName } from "@/lib/copy";
import type { Details } from "@/lib/details";
import type { Actor } from "@/lib/engine";
import type { Thread } from "@/lib/review";
import { useDiagrams } from "@/lib/diagrams";
import { leadsElsewhere, sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { openViewer } from "@/shared/Viewer";
import { AiAnswer } from "@/shared/AiAnswer";
import { AskAi } from "@/shared/AskAi";
import { Composer, ThreadView } from "./Thread";

function Person({ actor, className }: { actor: Actor; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-footnote">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** GitHub's HTML, cleaned (sanitize.ts); links open in the browser. */
function Html({ html, className }: { html: string; className?: string }) {
  const clean = sanitize(html);
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, clean);
  if (!clean.trim()) return <p className="text-body text-muted-foreground italic">No description.</p>;
  return (
    <div
      ref={ref}
      className={cn(
        // Text to read and copy: selectable, 13pt with room between the lines, links in the link colour.
        "selectable prose-sm text-body leading-(--type-reading-leading) break-words",
        "[&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-callout [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:text-title3 [&_h1]:font-semibold [&_h2]:text-headline [&_h2]:font-bold [&_h3]:font-semibold [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_video]:my-2 [&_video]:max-h-[70vh] [&_video]:max-w-full [&_video]:rounded-lg [&_video]:bg-black [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2",
        className,
      )}
      onClick={(e) => {
        // A picture opens in the viewer (even one GitHub wrapped in a link to itself).
        const picture = (e.target as Element).closest("img");
        if (picture && !leadsElsewhere(picture)) {
          e.preventDefault();
          openViewer({ src: picture.src, alt: picture.alt });
          return;
        }
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

/** The AI review's summary, and its comments that aren't on a line of the diff (GitHub only takes
 *  those on the diff's lines; these are for you to read). */
function ReviewSummary({ config, review, reviewing, error, onJump }: { config: Config; review: AiReview | null; reviewing: boolean; error: string | null; onJump: (path: string, line: number | null) => void }) {
  if (!review && !reviewing && !error) return null;
  const elsewhere = review?.findings.filter((f) => !f.inDiff) ?? [];
  const onLines = (review?.findings.length ?? 0) - elsewhere.length;
  return (
    <section aria-labelledby="ai-review" className="flex flex-col gap-2 rounded-xl border border-violet/30 bg-violet/5 p-3" aria-busy={reviewing}>
      <h3 id="ai-review" className="flex items-center gap-2 text-headline font-bold">
        <Sparkles className="size-3.5 text-violet" aria-hidden /> AI review
        <span className="font-normal text-muted-foreground">by {PROVIDERS[config.ai.provider ?? "claude"].name}</span>
        {reviewing ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Reviewing" /> : null}
      </h3>
      {error ? (
        <p className="text-callout text-destructive" role="alert">
          {error}
        </p>
      ) : reviewing ? (
        <p className="text-callout text-muted-foreground">{config.ai.project ? "Reading the project and the diff… this can take a few minutes." : "Reading the diff…"}</p>
      ) : review ? (
        <>
          {review.summary ? <AiAnswer text={review.summary} /> : null}
          <p className="text-callout text-muted-foreground">
            {review.findings.length ? `${onLines} comment${onLines === 1 ? "" : "s"} on the diff${elsewhere.length ? `, ${elsewhere.length} elsewhere` : ""}.` : "Nothing worth raising."}
            {review.note ? ` ${review.note}.` : review.project ? " Read the whole project." : ""}
          </p>
          {elsewhere.map((f, i) => (
            <div key={`${f.path}:${f.line}:${i}`} className="rounded-lg border bg-background p-2">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
                  {f.path}:{f.line}
                </p>
                <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onJump(f.path, null)} aria-label={`Show ${f.path} in the diff`}>
                  <ArrowDownToLine /> Go to File
                </Button>
              </div>
              <div className="mt-1">
                <AiAnswer text={f.body} />
              </div>
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}

type Props = {
  config: Config | null;
  details: Details;
  review: AiReview | null;
  reviewing: boolean;
  reviewError: string | null;
  /** Shows a file (at a line, when there is one) in the diff. */
  onJump: (path: string, line: number | null) => void;
  /** The conversations on lines, answered and resolved here as in the diff. */
  threads: Thread[];
  onReply: (thread: Thread, body: string) => Promise<void>;
  onResolve: (thread: Thread, resolved: boolean) => Promise<void>;
  /** A comment on the pull request itself, at the end of the conversation. */
  onComment: (body: string) => Promise<void>;
};

/** Where a conversation on a line is, with a way to it in the diff. */
function Where({ path, line, onJump }: { path: string; line: number | null; onJump: Props["onJump"] }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
        {path}
        {line ? `:${line}` : ""}
      </p>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onJump(path, line)} aria-label={`Show ${path}${line ? ` line ${line}` : ""} in the diff`}>
        <ArrowDownToLine /> {line ? "Go to Line" : "Go to File"}
      </Button>
    </div>
  );
}

/** The comment box at the end of the conversation, closed until it's wanted. */
function AddComment({ onComment }: { onComment: Props["onComment"] }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <Composer
      placeholder="Comment on this pull request"
      submitLabel="Comment"
      onSubmit={async (body) => {
        await onComment(body);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
      <MessageSquarePlus /> Add Comment
    </Button>
  );
}

export function Overview({ config, details, review, reviewing, reviewError, onJump, threads, onReply, onResolve, onComment }: Props) {
  // Each conversation on a line shows once, under the review that started it (as on GitHub); the
  // replies, which GitHub keeps as reviews of their own, are in it.
  const byComment = useMemo(() => new Map(threads.flatMap((t) => t.comments.map((c) => [c.id, t] as const))), [threads]);
  // A page to read: the description and the conversation in a column, and beside them what's at a
  // glance (the AI, reviewers, checks).
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="description" className="rounded-xl border bg-card p-5">
          <h2 id="description" className="sr-only">
            Description
          </h2>
          <div className="mb-3 flex items-center gap-2 text-callout text-muted-foreground">
            <Person actor={details.author} />
            <span>
              <span className="font-medium text-foreground">{firstName(details.author)}</span> opened it {ago(Date.parse(details.createdAt))} ago ·{" "}
              <span className="font-mono">{details.headRefName}</span> → <span className="font-mono">{details.baseRefName}</span>
            </span>
          </div>
          <Html html={details.html} />
        </section>
        <section aria-labelledby="conversation" className="flex flex-col gap-5">
          <h2 id="conversation" className="text-headline font-bold">
            Conversation <span className="font-normal text-muted-foreground tabular-nums">{details.entries.length}</span>
          </h2>
              {details.entries.length ? (
                details.entries.map((entry) => {
                  const parts =
                    entry.kind === "review"
                      ? entry.comments.flatMap((c): Array<{ key: string; comment: typeof c; thread: Thread | null }> => {
                          const thread = byComment.get(c.id);
                          if (!thread) return [{ key: c.id, comment: c, thread: null }];
                          return thread.comments[0]?.id === c.id ? [{ key: c.id, comment: c, thread }] : [];
                        })
                      : [];
                  // A review that's only replies to conversations shown above has nothing of its own.
                  if (entry.kind === "review" && !entry.html.trim() && !parts.length && entry.state === "COMMENTED") return null;
                  return (
                    <article key={entry.id} className="flex gap-2.5">
                      <Person actor={entry.author} className="mt-0.5 size-6" />
                      <div className="min-w-0 flex-1">
                        <p className="text-callout text-muted-foreground">
                          <span className="font-medium text-foreground">{firstName(entry.author)}</span>
                          {entry.kind === "review" ? <span className={cn(" ml-1", REVIEW_STATE[entry.state as keyof typeof REVIEW_STATE]?.className)}>{REVIEW_STATE[entry.state as keyof typeof REVIEW_STATE]?.label.toLowerCase()}</span> : null} · {ago(Date.parse(entry.at))}
                        </p>
                        {entry.html.trim() ? <Html html={entry.html} className="mt-1" /> : null}
                        {parts.map(({ key, comment: c, thread }) =>
                          thread ? (
                            <div key={key} className="mt-2">
                              <Where path={thread.path} line={thread.line || null} onJump={onJump} />
                              <ThreadView thread={thread} className="mx-0 my-0 max-w-none" onReply={(body) => onReply(thread, body)} onResolve={(resolved) => onResolve(thread, resolved)} />
                            </div>
                          ) : (
                            <div key={key} className="mt-2 rounded-lg border p-2">
                              <Where path={c.path} line={c.line} onJump={onJump} />
                              <Html html={c.html} />
                            </div>
                          ),
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="text-body text-muted-foreground">No conversation yet.</p>
              )}
              <AddComment onComment={onComment} />
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6" aria-label="At a glance">
        {config?.ai.provider ? <ReviewSummary config={config} review={review} reviewing={reviewing} error={reviewError} onJump={onJump} /> : null}
        {config ? <AskAi config={config} details={details} /> : null}
        <section aria-labelledby="reviewers" className="flex flex-col gap-2">
          <h3 id="reviewers" className="text-subheadline font-semibold text-muted-foreground">
            Reviewers
          </h3>
          {details.reviewers.length ? (
            <ul className="flex flex-col gap-1.5">
              {details.reviewers.map(({ actor, state, team }) => (
                <li key={`${actor?.login}${team ?? ""}`} className="flex items-center gap-2 text-body">
                  {team ? <span className="grid size-5 place-items-center rounded-full bg-muted text-footnote font-semibold">{team.slice(0, 2).toUpperCase()}</span> : <Person actor={actor} />}
                  <span className="truncate">{team ?? firstName(actor)}</span>
                  <span className={cn("ml-auto text-callout", REVIEW_STATE[state]?.className)}>{REVIEW_STATE[state]?.label ?? state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-callout text-muted-foreground">Nobody asked yet.</p>
          )}
        </section>
        {details.checks.length ? (
          <section aria-labelledby="checks" className="flex flex-col gap-2">
            <h3 id="checks" className="text-subheadline font-semibold text-muted-foreground">
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
                  <li key={check.name} className="text-body">
                    {check.url?.startsWith("https://") ? (
                      <button type="button" className="flex w-full cursor-default items-center gap-2 rounded text-left outline-none focus-ring" onClick={() => void bridge.openUrl(check.url!)}>
                        {row}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2">{row}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {details.checks.length > 12 ? <p className="text-callout text-muted-foreground">and {details.checks.length - 12} more</p> : null}
          </section>
        ) : null}
      </aside>
    </div>
  );
}
