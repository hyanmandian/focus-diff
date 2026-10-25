// The review window's side pane: the pull request's overview (AI, description, reviewers, checks)
// and its conversation, next to the diff.

import { CircleCheck, CircleDot, CircleMinus, CircleX, Loader2, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROVIDERS, type AiReview } from "@/lib/ai";
import { bridge } from "@/lib/bridge";
import type { Config } from "@/lib/config";
import { ago, firstName } from "@/lib/copy";
import type { Details } from "@/lib/details";
import type { Actor } from "@/lib/engine";
import { sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { AiAnswer } from "@/shared/AiAnswer";
import { AskAi } from "@/shared/AskAi";

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

/** The AI review's summary, and its comments that aren't on a line of the diff (GitHub only takes
 *  those on the diff's lines; these are for you to read). */
function ReviewSummary({ config, review, reviewing, error }: { config: Config; review: AiReview | null; reviewing: boolean; error: string | null }) {
  if (!review && !reviewing && !error) return null;
  const elsewhere = review?.findings.filter((f) => !f.inDiff) ?? [];
  const onLines = (review?.findings.length ?? 0) - elsewhere.length;
  return (
    <section aria-labelledby="ai-review" className="flex flex-col gap-2 rounded-xl border border-violet/30 bg-violet/5 p-3" aria-busy={reviewing}>
      <h3 id="ai-review" className="flex items-center gap-2 text-xs font-semibold">
        <Sparkles className="size-3.5 text-violet" aria-hidden /> AI review
        <span className="font-normal text-muted-foreground">by {PROVIDERS[config.ai.provider ?? "claude"].name}</span>
        {reviewing ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Reviewing" /> : null}
      </h3>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : reviewing ? (
        <p className="text-xs text-muted-foreground">{config.ai.project ? "Reading the project and the diff… this can take a few minutes." : "Reading the diff…"}</p>
      ) : review ? (
        <>
          {review.summary ? <AiAnswer text={review.summary} /> : null}
          <p className="text-xs text-muted-foreground">
            {review.findings.length ? `${onLines} comment${onLines === 1 ? "" : "s"} on the diff${elsewhere.length ? `, ${elsewhere.length} elsewhere` : ""}.` : "Nothing worth raising."}
            {review.note ? ` ${review.note}.` : review.project ? " Read the whole project." : ""}
          </p>
          {elsewhere.map((f, i) => (
            <div key={`${f.path}:${f.line}:${i}`} className="rounded-lg border bg-background p-2">
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {f.path}:{f.line}
              </p>
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

export function Inspector({ config, details, review, reviewing, reviewError }: { config: Config | null; details: Details; review: AiReview | null; reviewing: boolean; reviewError: string | null }) {
  return (
    <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList variant="line" className="mx-3 mt-1 shrink-0 justify-start">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="conversation">Conversation {details.entries.length ? <span className="text-muted-foreground tabular-nums">{details.entries.length}</span> : null}</TabsTrigger>
      </TabsList>
      <ScrollArea className="min-h-0 flex-1">
        <TabsContent value="overview" className="flex flex-col gap-5 p-4">
          {config?.ai.provider ? <ReviewSummary config={config} review={review} reviewing={reviewing} error={reviewError} /> : null}
          {config ? <AskAi config={config} details={details} /> : null}
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
      </ScrollArea>
    </Tabs>
  );
}
