// The review window's Overview tab: the pull request's description and conversation, with the AI,
// reviewers and checks beside them.

import { ArrowDownToLine, Loader2, MessageSquarePlus, Pencil, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PROVIDERS, type AiReview } from "@/lib/ai";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import type { Config } from "@/lib/config";
import { firstName } from "@/lib/copy";
import { useT } from "@/lib/i18n";
import type { Conversation, ConversationEntry } from "@/lib/conversation";
import type { Details, Entry } from "@/lib/details";
import type { Actor } from "@/lib/engine";
import type { Range } from "@/lib/commits";
import type { Thread } from "@/lib/review";
import { useDiagrams } from "@/lib/diagrams";
import { leadsElsewhere, sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { openViewer } from "@/shared/Viewer";
import { AiAnswer } from "@/shared/AiAnswer";
import { AskAi } from "@/shared/AskAi";
import { byTime } from "@/lib/timeline";
import { quote } from "@/lib/writing";
import { Checks } from "./Checks";
import { CommitsSection } from "./Commits";
import { useConversationApi } from "./conversation";
import { MergeBox } from "./MergeBox";
import { CommentMenu, ReactionList, ReactionPicker, useReactions } from "./Said";
import { Sidebar } from "./Sidebar";
import { Composer, ThreadView } from "./Thread";
import { TimelineRow } from "./Timeline";
import type { Pull } from "./usePull";

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
  const t = useT();
  const clean = sanitize(html);
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, clean);
  if (!clean.trim()) return <p className="text-body text-muted-foreground italic">{t("review.noDescription")}</p>;
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

// Their words: t(`review.state.${state}`) on its own, t(`review.did.${state}`) after a name.
const REVIEW_STATE = {
  APPROVED: "text-success",
  CHANGES_REQUESTED: "text-destructive",
  COMMENTED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
  DISMISSED: "text-muted-foreground",
} as const;
type ReviewState = keyof typeof REVIEW_STATE;
const isReviewState = (state: string): state is ReviewState => state in REVIEW_STATE;

/** The AI review's summary, and its comments that aren't on a line of the diff (GitHub only takes
 *  those on the diff's lines; these are for you to read). */
function ReviewSummary({ config, review, reviewing, error, onJump }: { config: Config; review: AiReview | null; reviewing: boolean; error: string | null; onJump: (path: string, line: number | null) => void }) {
  const t = useT();
  if (!review && !reviewing && !error) return null;
  const elsewhere = review?.findings.filter((f) => !f.inDiff) ?? [];
  const onLines = (review?.findings.length ?? 0) - elsewhere.length;
  return (
    <section aria-labelledby="ai-review" className="flex flex-col gap-2 rounded-xl border border-violet/30 bg-violet/5 p-3" aria-busy={reviewing}>
      <h3 id="ai-review" className="flex items-center gap-2 text-headline font-bold">
        <Sparkles className="size-3.5 text-violet" aria-hidden /> {t("review.aiReviewHeading")}
        <span className="font-normal text-muted-foreground">{t("review.by", { name: PROVIDERS[config.ai.provider ?? "claude"].name })}</span>
        {reviewing ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label={t("review.reviewing")} /> : null}
      </h3>
      {error ? (
        <p className="text-callout text-destructive" role="alert">
          {error}
        </p>
      ) : reviewing ? (
        <p className="text-callout text-muted-foreground">{config.ai.project ? t("review.readingProject") : t("review.readingDiff")}</p>
      ) : review ? (
        <>
          {review.summary ? <AiAnswer text={review.summary} /> : null}
          <p className="text-callout text-muted-foreground">
            {review.findings.length
              ? elsewhere.length
                ? t("review.onDiffElsewhere", { count: onLines, elsewhere: elsewhere.length })
                : t("review.onDiff", { count: onLines })
              : t("review.nothingWorth")}
            {review.note ? ` ${review.note}.` : review.project ? ` ${t("review.readProject")}` : ""}
          </p>
          {elsewhere.map((f, i) => (
            <div key={`${f.path}:${f.line}:${i}`} className="rounded-lg border bg-background p-2">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
                  {f.path}:{f.line}
                </p>
                <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onJump(f.path, null)} aria-label={t("review.showInDiff", { path: f.path })}>
                  <ArrowDownToLine /> {t("review.goToFile")}
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
  /** The whole conversation, with what you may do to each part of it; the details' latest until
   *  it's loaded (lib/conversation.ts). */
  conversation?: Conversation | null;
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
  /** What's around the pull request (usePull.ts): merging, checks, commits, people, the timeline. */
  pull: Pull;
  me: string | null;
  /** Shows a range of commits in the diff. */
  onOpenRange: (range: Range) => void;
  /** Whether the diff has a file, to offer a way to it. */
  hasFile: (path: string) => boolean;
  say: (message: string) => void;
};

/** Where a conversation on a line is, with a way to it in the diff. */
function Where({ path, line, onJump }: { path: string; line: number | null; onJump: Props["onJump"] }) {
  const t = useT();
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
        {path}
        {line ? `:${line}` : ""}
      </p>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onJump(path, line)} aria-label={line ? t("review.showLineInDiff", { path, line: String(line) }) : t("review.showInDiff", { path })}>
        <ArrowDownToLine /> {line ? t("review.goToLine") : t("review.goToFile")}
      </Button>
    </div>
  );
}

/** The comment box at the end of the conversation, closed until it's wanted (or a quote opens it). */
function AddComment({ onComment, quoted, onQuoted }: { onComment: Props["onComment"]; quoted: string | null; onQuoted: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return open || quoted !== null ? (
    <Composer
      key={quoted ?? ""}
      placeholder={t("review.commentOnPull")}
      submitLabel={t("review.comment")}
      initial={quoted ?? ""}
      onSubmit={async (body) => {
        await onComment(body);
        setOpen(false);
        onQuoted();
      }}
      onCancel={() => {
        setOpen(false);
        onQuoted();
      }}
    />
  ) : (
    <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
      <MessageSquarePlus /> {t("review.addComment")}
    </Button>
  );
}

/** What someone said, editable when it's yours: the description, a comment, a review's own words. */
function Words({ html, body, editing, onSave, onDone, className }: { html: string; body?: string; editing: boolean; onSave: (body: string) => Promise<void>; onDone: () => void; className?: string }) {
  const t = useT();
  if (editing && body !== undefined)
    return (
      <div className={cn("mt-1", className)}>
        <Composer
          placeholder={t("review.commentPlaceholder")}
          submitLabel={t("review.save")}
          initial={body}
          onSubmit={async (text) => {
            await onSave(text);
            onDone();
          }}
          onCancel={onDone}
        />
      </div>
    );
  return html.trim() ? <Html html={html} className={className} /> : null;
}

/** One entry in the conversation: a comment on the pull request or a review, with the conversations
 *  it started on lines. */
function EntryView({ entry, byComment, onJump, onReply, onResolve, onQuote }: { entry: Entry & Partial<ConversationEntry>; byComment: Map<string, Thread>; onQuote: (text: string) => void } & Pick<Props, "onJump" | "onReply" | "onResolve">) {
  const t = useT();
  const api = useConversationApi();
  const [editing, setEditing] = useState(false);
  const [reactions, toggle] = useReactions(entry.id, entry.reactions ?? []);
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
  // A review's words can be edited, not deleted; a comment both.
  const said = entry.kind === "comment" || entry.html.trim() || editing;
  return (
    <article className="flex gap-2.5">
      <Person actor={entry.author} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-0.5">
          <p className="min-w-0 flex-1 text-callout text-muted-foreground">
            <span className="font-medium text-foreground">{firstName(entry.author, t)}</span>
            {entry.kind === "review" && isReviewState(entry.state) ? <span className={cn(" ml-1", REVIEW_STATE[entry.state])}>{t(`review.did.${entry.state}`)}</span> : null} · {t.since(Date.parse(entry.at))}
            {entry.edited ? ` · ${t("review.edited")}` : ""}
          </p>
          {api && said && entry.canReact ? <ReactionPicker reactions={reactions} onToggle={toggle} /> : null}
          {api ? (
            <CommentMenu
              url={entry.url}
              onQuote={entry.body ? () => onQuote(quote(entry.body ?? "")) : undefined}
              onEdit={entry.canEdit && entry.body !== undefined ? () => setEditing(true) : undefined}
              onDelete={entry.kind === "comment" && entry.canDelete ? () => void api.deleteEntry(entry.id) : undefined}
            />
          ) : null}
        </div>
        <Words html={entry.html} body={entry.body} editing={editing} className="mt-1" onSave={(body) => api?.editEntry(entry.kind, entry.id, body) ?? Promise.resolve()} onDone={() => setEditing(false)} />
        {said ? <ReactionList reactions={reactions} canReact={Boolean(api && entry.canReact)} onToggle={toggle} /> : null}
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
}

/** The newest this many show first; older ones a page at a time, so a long conversation opens as
 *  fast as a short one. */
const PAGE = 30;

/** The description: the author's words, editable when you may, with its reactions. */
function Description({ details, conversation }: { details: Details; conversation: Conversation | null | undefined }) {
  const t = useT();
  const api = useConversationApi();
  const [editing, setEditing] = useState(false);
  const [reactions, toggle] = useReactions(details.id, conversation?.reactions ?? []);
  // "{who} opened it {ago}", with the name set apart.
  const [beforeWho, afterWho] = t("review.openedBy", { who: "\u0000", ago: t.ago(Date.parse(details.createdAt)) }).split("\u0000");
  const html = conversation?.html ?? details.html;
  return (
    <section aria-labelledby="description" className="rounded-xl border bg-card p-5">
      <h2 id="description" className="sr-only">
        {t("review.description")}
      </h2>
      <div className="mb-3 flex items-center gap-2 text-callout text-muted-foreground">
        <Person actor={details.author} />
        <span className="min-w-0 flex-1">
          {beforeWho}
          <span className="font-medium text-foreground">{firstName(details.author, t)}</span>
          {afterWho} ·{" "}
          <span className="font-mono">{details.headRefName}</span> → <span className="font-mono">{details.baseRefName}</span>
        </span>
        {api && conversation?.canReact ? <ReactionPicker reactions={reactions} onToggle={toggle} /> : null}
        {api && conversation?.canEdit && !editing ? (
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("review.editDescription")} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
        ) : null}
      </div>
      {editing || html.trim() ? (
        <Words html={html} body={conversation?.body} editing={editing} onSave={(body) => api?.editDescription(body) ?? Promise.resolve()} onDone={() => setEditing(false)} />
      ) : (
        <Html html={html} />
      )}
      <ReactionList reactions={reactions} canReact={Boolean(api && conversation?.canReact)} onToggle={toggle} />
    </section>
  );
}

export function Overview({ config, details, conversation, review, reviewing, reviewError, onJump, threads, onReply, onResolve, onComment, pull, me, onOpenRange, hasFile, say }: Props) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  const [quoted, setQuoted] = useState<string | null>(null);
  const entries: Array<Entry & Partial<ConversationEntry>> = conversation?.entries ?? details.entries;
  // Each conversation on a line shows once, under the review that started it (as on GitHub); the
  // replies, which GitHub keeps as reviews of their own, are in it.
  const byComment = useMemo(() => new Map(threads.flatMap((t) => t.comments.map((c) => [c.id, t] as const))), [threads]);
  // What happened (commits, labels, merging...) among what was said, as on GitHub.
  const items = useMemo(() => byTime(entries, pull.events), [entries, pull.events]);
  // A page to read: the description and the conversation in a column, and beside them what's at a
  // glance (the AI, reviewers, checks).
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-8">
        <Description details={details} conversation={conversation} />
        <MergeBox details={details} pull={pull} />
        <Checks pr={details} pull={pull} hasFile={hasFile} onJump={onJump} say={say} />
        <CommitsSection pull={pull} onOpen={onOpenRange} />
        <section aria-labelledby="conversation" className="flex flex-col gap-5">
          <h2 id="conversation" className="text-headline font-bold">
            {t("review.conversation")} <span className="font-normal text-muted-foreground tabular-nums">{entries.length}</span>
          </h2>
              {items.length ? (
                items
                  .slice(0, shown)
                  .map((item) =>
                    item.kind === "event" ? (
                      <TimelineRow key={item.event.id} event={item.event} />
                    ) : (
                      <EntryView key={item.entry.id} entry={item.entry} byComment={byComment} onJump={onJump} onReply={onReply} onResolve={onResolve} onQuote={setQuoted} />
                    ),
                  )
              ) : (
                <p className="text-body text-muted-foreground">{t("review.noConversation")}</p>
              )}
              {items.length > shown ? (
                <Button variant="ghost" size="sm" className="self-start text-link" onClick={() => setShown((n) => n + PAGE * 3)}>
                  {t("review.showOlder", { count: Math.min(items.length - shown, PAGE * 3) })}
                </Button>
              ) : pull.older ? (
                <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => void pull.loadOlder().catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))}>
                  {t("manage.olderEvents")}
                </Button>
              ) : null}
              <AddComment onComment={onComment} quoted={quoted} onQuoted={() => setQuoted(null)} />
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6" aria-label={t("review.atAGlance")}>
        {config?.ai.provider ? <ReviewSummary config={config} review={review} reviewing={reviewing} error={reviewError} onJump={onJump} /> : null}
        {config ? <AskAi config={config} details={details} /> : null}
        <Sidebar pr={details} details={details} pull={pull} me={me} onError={say} />
      </aside>
    </div>
  );
}
