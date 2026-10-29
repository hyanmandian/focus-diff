import { ArrowDownToLine, ArrowLeft, Check, Copy, Loader2, MessageSquarePlus, Pencil, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AiAnswer } from "@/components/ai-answer/ai-answer";
import { AskAi } from "@/components/ask-ai/ask-ai";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar/avatar";
import { Button } from "@/components/button/button";
import { Checks } from "@/components/checks/checks";
import { CommitsSection } from "@/components/commits/commits";
import { MergeBox } from "@/components/merge-box/merge-box";
import { ACTIONS, CommentMenu, ReactionList, ReactionPicker, useReactions } from "@/components/said/said";
import { Sidebar } from "@/components/sidebar/sidebar";
import { StackCard } from "@/components/stack-card/stack-card";
import { Composer, ThreadView } from "@/components/thread/thread";
import { TimelineRow } from "@/components/timeline/timeline";
import { openViewer } from "@/components/viewer/viewer";
import { copyText, useConversationApi } from "@/hooks/use-conversation/use-conversation";
import type { Pull } from "@/hooks/use-pull/use-pull";
import type { Stack } from "@/hooks/use-stack/use-stack";
import { PROVIDERS, type AiReview } from "@/utils/ai/ai";
import { avatar } from "@/utils/avatar/avatar";
import { bridge } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import type { Range } from "@/utils/commits/commits";
import type { Config } from "@/utils/config/config";
import type { Conversation, ConversationEntry } from "@/utils/conversation/conversation";
import { firstName } from "@/utils/copy/copy";
import type { Details, Entry } from "@/utils/details/details";
import { useDiagrams } from "@/utils/diagrams/diagrams";
import type { Actor } from "@/utils/engine/engine";
import { errorText } from "@/utils/error/error";
import { useT } from "@/utils/i18n/i18n";
import type { Thread } from "@/utils/review/review";
import { leadsElsewhere, sanitize } from "@/utils/sanitize/sanitize";
import type { StackPull } from "@/utils/stack/stack";
import { byTime } from "@/utils/timeline/timeline";
import { typed } from "@/utils/typing/typing";
import { quote } from "@/utils/writing/writing";

function Person({ actor, className }: { actor: Actor; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-footnote">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function Html({ html, className }: { html: string; className?: string }) {
  const t = useT();
  const clean = sanitize(html);
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, clean);
  if (!clean.trim()) return <p className="text-body text-muted-foreground italic">{t("review.noDescription")}</p>;
  return (
    <div
      ref={ref}
      role="presentation"
      className={cn(
        "selectable prose-sm text-body leading-(--type-reading-leading) break-words",
        "[&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-callout [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:text-title3 [&_h1]:font-semibold [&_h2]:text-headline [&_h2]:font-bold [&_h3]:font-semibold [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_video]:my-2 [&_video]:max-h-[70vh] [&_video]:max-w-full [&_video]:rounded-lg [&_video]:bg-black",
        "[&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2",
        className,
      )}
      onClick={(e) => {
        const target = e.target instanceof Element && e.target;
        const picture = target && target.closest("img");
        if (picture && !leadsElsewhere(picture)) {
          e.preventDefault();
          openViewer({ src: picture.src, alt: picture.alt });
          return;
        }
        const link = target && target.closest<HTMLAnchorElement>("a[href]");
        if (link) {
          e.preventDefault();
          void bridge.openUrl(link.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

const REVIEW_STATE = {
  APPROVED: "text-success",
  CHANGES_REQUESTED: "text-destructive",
  COMMENTED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
  DISMISSED: "text-muted-foreground",
} as const;
type ReviewState = keyof typeof REVIEW_STATE;
const isReviewState = (state: string): state is ReviewState => state in REVIEW_STATE;

function ReviewSummary({
  by,
  project,
  review,
  reviewing,
  error,
  onJump,
}: {
  by: string;
  project: boolean;
  review: AiReview | null;
  reviewing: boolean;
  error: string | null;
  onJump: (path: string, line: number | null) => void;
}) {
  const t = useT();
  if (!review && !reviewing && !error) return null;
  const elsewhere = review?.findings.filter((f) => !f.inDiff) ?? [];
  const onLines = (review?.findings.length ?? 0) - elsewhere.length;
  return (
    <section
      aria-labelledby="ai-review"
      className="flex flex-col gap-2 rounded-xl border border-violet/30 bg-violet/5 p-3"
      aria-busy={reviewing}
    >
      <h3 id="ai-review" className="flex items-center gap-2 text-headline font-bold">
        <Sparkles className="size-3.5 text-violet" aria-hidden /> {t("review.aiReviewHeading")}
        <span className="font-normal text-muted-foreground">{t("review.by", { name: by })}</span>
        {reviewing ? (
          <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label={t("review.reviewing")} />
        ) : null}
      </h3>
      {error ? (
        <p className="text-callout text-destructive" role="alert">
          {error}
        </p>
      ) : !reviewing && review ? (
        <>
          {review.summary ? <AiAnswer text={review.summary} /> : null}
          <p className="text-callout text-muted-foreground">
            {review.findings.length > 0
              ? elsewhere.length > 0
                ? t("review.onDiffElsewhere", { count: onLines, elsewhere: elsewhere.length })
                : t("review.onDiff", { count: onLines })
              : t("review.nothingWorth")}
            {review.note
              ? ` ${review.note}${review.note.endsWith(".") ? "" : "."}`
              : review.project
                ? ` ${t("review.readProject")}`
                : ""}
          </p>
          {elsewhere.map((f) => (
            <div key={`${f.path}:${f.line}:${f.body}`} className="rounded-lg border bg-background p-2">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
                  {f.path}:{f.line}
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0"
                  onClick={() => {
                    onJump(f.path, null);
                  }}
                  aria-label={t("review.showInDiff", { path: f.path })}
                >
                  <ArrowDownToLine /> {t("review.goToFile")}
                </Button>
              </div>
              <div className="mt-1">
                <AiAnswer text={f.body} />
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="text-callout text-muted-foreground">
          {project ? t("review.readingProject") : t("review.readingDiff")}
        </p>
      )}
    </section>
  );
}

type Props = {
  config: Config | null;
  details: Details;
  conversation?: Conversation | null;
  review: AiReview | null;
  reviewing: boolean;
  reviewError: string | null;
  onJump: (path: string, line: number | null) => void;
  threads: Thread[];
  onReply: (thread: Thread, body: string) => Promise<void>;
  onResolve: (thread: Thread, resolved: boolean) => Promise<void>;
  onComment: (body: string) => Promise<string | undefined>;
  pull: Pull;
  me: string | null;
  onOpenRange: (range: Range) => void;
  hasFile: (path: string) => boolean;
  say: (message: string) => void;
  stack?: Stack | null;
  onPickStack?: (pull: StackPull) => void;
};

function Where({ path, line, onJump }: { path: string; line: number | null; onJump: Props["onJump"] }) {
  const t = useT();
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
        {path}
        {line ? `:${line}` : ""}
      </p>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0"
        onClick={() => {
          onJump(path, line);
        }}
        aria-label={line ? t("review.showLineInDiff", { path, line: String(line) }) : t("review.showInDiff", { path })}
      >
        <ArrowDownToLine /> {line ? t("review.goToLine") : t("review.goToFile")}
      </Button>
    </div>
  );
}

function AddComment({
  pull,
  onComment,
  quoted,
  onQuoted,
}: {
  pull: string;
  onComment: Props["onComment"];
  quoted: string | null;
  onQuoted: () => void;
}) {
  const t = useT();
  const keep = `comment:${pull}`;
  const [open, setOpen] = useState(() => typed(keep) !== null);
  return open || quoted !== null ? (
    <Composer
      placeholder={t("review.commentOnPull")}
      submitLabel={t("review.comment")}
      initial={quoted ?? ""}
      keep={keep}
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
    <Button
      variant="outline"
      className="self-start"
      onClick={() => {
        setOpen(true);
      }}
    >
      <MessageSquarePlus /> {t("review.addComment")}
    </Button>
  );
}

function Words({
  html,
  body,
  editing,
  keep,
  onSave,
  onDone,
  className,
}: {
  keep: string;
  html: string;
  body?: string;
  editing: boolean;
  onSave: (body: string) => Promise<void>;
  onDone: () => void;
  className?: string;
}) {
  const t = useT();
  if (editing && body !== undefined)
    return (
      <div className={cn("mt-1", className)}>
        <Composer
          placeholder={t("review.commentPlaceholder")}
          submitLabel={t("review.save")}
          initial={body}
          keep={keep}
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

function EntryView({
  entry,
  byComment,
  onJump,
  onReply,
  onResolve,
  onQuote,
}: {
  entry: Entry & Partial<ConversationEntry>;
  byComment: Map<string, Thread>;
  onQuote: (text: string) => void;
} & Pick<Props, "onJump" | "onReply" | "onResolve">) {
  const t = useT();
  const api = useConversationApi();
  const [editing, setEditing] = useState(() => typed(`edit:${entry.id}`) !== null);
  const [reactions, toggle] = useReactions(entry.id, entry.reactions ?? []);
  const words = entry.body;
  const parts =
    entry.kind === "review"
      ? entry.comments.flatMap((c): Array<{ key: string; comment: typeof c; thread: Thread | null }> => {
          const thread = byComment.get(c.id);
          if (!thread) return [{ key: c.id, comment: c, thread: null }];
          return thread.comments[0]?.id === c.id ? [{ key: c.id, comment: c, thread }] : [];
        })
      : [];
  if (entry.kind === "review" && !entry.html.trim() && parts.length === 0 && entry.state === "COMMENTED") return null;
  const said = entry.kind === "comment" || entry.html.trim() || editing;
  return (
    <article data-entry={entry.id} className="group/said -m-2 flex scroll-mt-16 gap-2.5 rounded-[10px] p-2">
      <Person actor={entry.author} className="mt-0.5 size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-0.5">
          <p className="min-w-0 flex-1 text-callout text-muted-foreground">
            <span className="font-medium text-foreground">{firstName(entry.author, t)}</span>
            {entry.kind === "review" && isReviewState(entry.state) ? (
              <span className={cn("ml-1", REVIEW_STATE[entry.state])}>{t(`review.did.${entry.state}`)}</span>
            ) : null}{" "}
            · {t.since(Date.parse(entry.at))}
            {entry.edited ? ` · ${t("review.edited")}` : ""}
          </p>
          {api ? (
            <span className={ACTIONS}>
              {said && entry.canReact ? <ReactionPicker reactions={reactions} onToggle={toggle} /> : null}
              <CommentMenu
                url={entry.url}
                onQuote={
                  words
                    ? () => {
                        onQuote(quote(words));
                      }
                    : undefined
                }
                onEdit={
                  entry.canEdit && entry.body !== undefined
                    ? () => {
                        setEditing(true);
                      }
                    : undefined
                }
                onDelete={
                  entry.kind === "comment" && entry.canDelete ? () => void api.deleteEntry(entry.id) : undefined
                }
              />
            </span>
          ) : null}
        </div>
        <Words
          html={entry.html}
          body={entry.body}
          editing={editing}
          keep={`edit:${entry.id}`}
          className="mt-1"
          onSave={async (body) => {
            await api?.editEntry(entry.kind, entry.id, body);
          }}
          onDone={() => {
            setEditing(false);
          }}
        />
        {said ? (
          <ReactionList reactions={reactions} canReact={Boolean(api && entry.canReact)} onToggle={toggle} />
        ) : null}
        {parts.map(({ key, comment: c, thread }) =>
          thread ? (
            <div key={key} className="mt-2">
              <Where path={thread.path} line={thread.line || null} onJump={onJump} />
              <ThreadView
                thread={thread}
                className="mx-0 my-0 max-w-none"
                onReply={(body) => onReply(thread, body)}
                onResolve={(resolved) => onResolve(thread, resolved)}
              />
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

const PAGE = 30;

function Branch({ name }: { name: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const timer = copied
      ? setTimeout(() => {
          setCopied(false);
        }, 1500)
      : undefined;
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  const copy = async () => {
    await copyText(name);
    setCopied(true);
  };
  return (
    <span className="inline-flex max-w-full min-w-0 items-center rounded-[6px] bg-fill pl-1.5 text-foreground">
      <span className="selectable truncate font-mono text-subheadline" title={name}>
        {name}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground"
        aria-label={copied ? t("review.branchCopied") : t("review.copyBranch", { name })}
        onClick={() => void copy()}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
    </span>
  );
}

function Heading({ details }: { details: Details }) {
  const t = useT();
  const [beforeWho, afterWho] = t("review.openedBy", {
    who: "\u0000",
    ago: t.ago(Date.parse(details.createdAt)),
  }).split("\u0000");
  return (
    <header className="-mb-3 flex gap-3">
      <Person actor={details.author} className="mt-0.5 size-8" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="selectable text-title2 leading-tight font-bold text-balance [overflow-wrap:anywhere]">
          {details.title} <span className="font-normal text-muted-foreground tabular-nums">#{details.number}</span>
        </h1>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-callout text-muted-foreground">
          <span>
            {beforeWho}
            <span className="font-medium text-foreground">{firstName(details.author, t)}</span>
            {afterWho}
          </span>
          <span aria-hidden>·</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <Branch name={details.baseRefName} />
            <ArrowLeft className="size-3.5 shrink-0" aria-label={t("review.from")} />
            <Branch name={details.headRefName} />
          </span>
        </div>
      </div>
    </header>
  );
}

function Description({ details, conversation }: { details: Details; conversation: Conversation | null | undefined }) {
  const t = useT();
  const api = useConversationApi();
  const [editing, setEditing] = useState(() => typed(`edit:${details.id}`) !== null);
  const [reactions, toggle] = useReactions(details.id, conversation?.reactions ?? []);
  const html = conversation?.html ?? details.html;
  return (
    <section aria-labelledby="description" className="rounded-xl border bg-card p-5">
      <h2 id="description" className="sr-only">
        {t("review.description")}
      </h2>
      <div className="float-right -mt-2 -mr-2 ml-2 flex items-center">
        {api && conversation?.canReact ? <ReactionPicker reactions={reactions} onToggle={toggle} /> : null}
        {api && conversation?.canEdit && !editing ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={t("review.editDescription")}
            onClick={() => {
              setEditing(true);
            }}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
      {editing || html.trim() ? (
        <Words
          html={html}
          body={conversation?.body}
          editing={editing}
          keep={`edit:${details.id}`}
          onSave={async (body) => {
            await api?.editDescription(body);
          }}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : (
        <Html html={html} />
      )}
      <ReactionList reactions={reactions} canReact={Boolean(api && conversation?.canReact)} onToggle={toggle} />
    </section>
  );
}

export function Overview({
  config,
  details,
  conversation,
  review,
  reviewing,
  reviewError,
  onJump,
  threads,
  onReply,
  onResolve,
  onComment,
  pull,
  me,
  onOpenRange,
  hasFile,
  say,
  stack,
  onPickStack,
}: Props) {
  const t = useT();
  const [shown, setShown] = useState(PAGE);
  const [quoted, setQuoted] = useState<string | null>(null);
  const entries: Array<Entry & Partial<ConversationEntry>> = conversation?.entries ?? details.entries;
  const byComment = useMemo(
    () => new Map(threads.flatMap((thread) => thread.comments.map((c) => [c.id, thread] as const))),
    [threads],
  );
  const items = useMemo(() => byTime(entries, pull.events), [entries, pull.events]);
  const [landed, setLanded] = useState<string | null>(null);
  const lit = useRef<string | null>(null);
  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    if (landed !== null && landed !== lit.current) {
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = still ? "auto" : "smooth";
      const entry = items.some((item) => item.kind === "entry" && item.entry.id === landed)
        ? document.querySelector<HTMLElement>(`[data-entry="${CSS.escape(landed)}"]`)
        : null;
      if (entry) {
        lit.current = landed;
        entry.scrollIntoView({ behavior, block: "center" });
        entry.animate(
          [
            { backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)" },
            { backgroundColor: "transparent" },
          ],
          { duration: 1800, delay: still ? 0 : 300, easing: "ease-out" },
        );
      } else {
        document.querySelector("#conversation")?.scrollIntoView({ behavior, block: "start" });
        giveUp = setTimeout(() => {
          setLanded(null);
        }, 4000);
      }
    }
    return () => {
      clearTimeout(giveUp);
    };
  }, [landed, items]);
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-8">
        <Heading details={details} />
        {stack && onPickStack ? <StackCard stack={stack} onPick={onPickStack} /> : null}
        <Description details={details} conversation={conversation} />
        <MergeBox details={details} pull={pull} />
        <Checks pr={details} pull={pull} hasFile={hasFile} onJump={onJump} say={say} />
        <CommitsSection pull={pull} onOpen={onOpenRange} />
        <section aria-labelledby="conversation" className="flex flex-col gap-5">
          <h2 id="conversation" className="text-headline font-bold">
            {t("review.conversation")}{" "}
            <span className="font-normal text-muted-foreground tabular-nums">{entries.length}</span>
          </h2>
          {items.length > 0 ? (
            items
              .slice(0, shown)
              .map((item) =>
                item.kind === "event" ? (
                  <TimelineRow key={item.event.id} event={item.event} />
                ) : (
                  <EntryView
                    key={item.entry.id}
                    entry={item.entry}
                    byComment={byComment}
                    onJump={onJump}
                    onReply={onReply}
                    onResolve={onResolve}
                    onQuote={setQuoted}
                  />
                ),
              )
          ) : (
            <p className="text-body text-muted-foreground">{t("review.noConversation")}</p>
          )}
          {items.length > shown ? (
            <Button
              variant="ghost"
              className="self-start text-link"
              onClick={() => {
                setShown((n) => n + PAGE * 3);
              }}
            >
              {t("review.showOlder", { count: Math.min(items.length - shown, PAGE * 3) })}
            </Button>
          ) : pull.older ? (
            <Button
              variant="ghost"
              className="self-start text-muted-foreground"
              onClick={() =>
                void pull.loadOlder().catch((e: unknown) => {
                  say(errorText(e));
                })
              }
            >
              {t("manage.olderEvents")}
            </Button>
          ) : null}
          <AddComment
            pull={details.id}
            onComment={async (body) => {
              const id = await onComment(body);
              setLanded(id ?? "");
              return id;
            }}
            quoted={quoted}
            onQuoted={() => {
              setQuoted(null);
            }}
          />
        </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6" aria-label={t("review.atAGlance")}>
        {config?.ai.provider ? (
          <ReviewSummary
            by={PROVIDERS[config.ai.provider].name}
            project={config.ai.project}
            review={review}
            reviewing={reviewing}
            error={reviewError}
            onJump={onJump}
          />
        ) : null}
        {config ? <AskAi config={config} details={details} /> : null}
        <Sidebar details={details} pull={pull} me={me} onError={say} />
      </aside>
    </div>
  );
}
