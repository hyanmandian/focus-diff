// What sits between a file's lines: a conversation (with replies and resolving), a comment written
// for this review, or the box to write one.

import { AlertCircle, Check, CloudUpload, CornerDownRight, Loader2, MessageSquare, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Textarea } from "@/components/ui/textarea";
import type { Exchange, Finding } from "@/lib/ai";
import type { AiAnswer as Answer } from "@/lib/bridge";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import { firstName } from "@/lib/copy";
import { i18n, useT } from "@/lib/i18n";
import type { Actor } from "@/lib/engine";
import type { Draft, Thread as ThreadData, ThreadComment } from "@/lib/review";
import { linesFromPatch } from "@/lib/suggestion";
import { quote } from "@/lib/writing";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { isMac } from "@/lib/platform";
import { SlidingPill } from "@/shared/SlidingPill";
import { AiAnswer } from "@/shared/AiAnswer";
import { useConversationApi } from "./conversation";
import { CommentHtml } from "./CommentHtml";
import { ACTIONS, CommentMenu, ReactionList, ReactionPicker, useReactions } from "./Said";
import { SuggestionActions } from "./Suggestion";
import { MarkdownField } from "./Writer";

function Person({ actor }: { actor: Actor }) {
  return (
    <Avatar className="size-5">
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-footnote">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** A box to write in (Markdown, with a preview): ⌘/Ctrl+Enter sends, Esc cancels. */
export function Composer({
  placeholder,
  submitLabel,
  initial = "",
  onSubmit,
  onCancel,
  secondary,
  suggestion,
  base,
}: {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel: () => void;
  secondary?: { label: string; onClick: (body: string) => Promise<void> | void };
  /** The lines it's on, to suggest a change to. */
  suggestion?: string[] | null;
  base?: string[];
}) {
  const t = useT();
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: (body: string) => Promise<void> | void) => {
    if (!body.trim()) return setError(i18n()("review.writeFirst"));
    setBusy(true);
    setError(null);
    try {
      await action(body.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <MarkdownField value={body} onChange={setBody} label={placeholder} placeholder={placeholder} onSubmit={() => void run(onSubmit)} onCancel={onCancel} suggestion={suggestion} base={base} />
      {error ? (
        <p className="text-callout text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        {secondary ? (
          <Button variant="outline" onClick={() => void run(secondary.onClick)} disabled={busy}>
            {secondary.label}
          </Button>
        ) : null}
        <Button onClick={() => void run(onSubmit)} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

const Box = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  // Chrome around what's said: not selectable itself (the code around it is), the comments are.
  <div className={cn("mx-3 my-2 max-w-3xl rounded-xl border bg-card p-3 font-sans text-body text-card-foreground shadow-sm select-none", className)}>{children}</div>
);

/** A conversation folds its middle once it's longer than this, as GitHub's do. */
const LONG_THREAD = 8;

/** One comment in a conversation: who and when, what they said (editable when it's yours), its
 *  suggested change, its reactions. */
function CommentView({ thread, comment, onQuote }: { thread: ThreadData; comment: ThreadComment; onQuote: (text: string) => void }) {
  const t = useT();
  const api = useConversationApi();
  const [editing, setEditing] = useState(false);
  const [reactions, toggle] = useReactions(comment.id, comment.reactions ?? []);
  return (
    <div className="group/said flex gap-2">
      <Person actor={comment.author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-0.5">
          <p className="min-w-0 flex-1 text-callout text-muted-foreground">
            <span className="font-medium text-foreground">{firstName(comment.author, t)}</span> · {t.since(Date.parse(comment.at))}
            {comment.edited ? ` · ${t("review.edited")}` : ""}
            {thread.outdated ? ` · ${t("review.outdated")}` : ""}
          </p>
          {api ? (
            <span className={ACTIONS}>
              {comment.canReact ? <ReactionPicker reactions={reactions} onToggle={toggle} /> : null}
              <CommentMenu
                url={comment.url}
                onQuote={comment.body !== undefined ? () => onQuote(comment.body ?? "") : undefined}
                onEdit={comment.canEdit && comment.body !== undefined ? () => setEditing(true) : undefined}
                onDelete={comment.canDelete ? () => void api.deleteComment(comment) : undefined}
              />
            </span>
          ) : null}
        </div>
        {editing && api ? (
          <div className="mt-1">
            <Composer
              placeholder={t("review.commentPlaceholder")}
              submitLabel={t("review.save")}
              initial={comment.body}
              onSubmit={async (body) => {
                await api.editComment(comment, body);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <CommentHtml html={comment.html} />
        )}
        <SuggestionActions thread={thread} comment={comment} />
        <ReactionList reactions={reactions} canReact={Boolean(api && comment.canReact)} onToggle={toggle} />
      </div>
    </div>
  );
}

export function ThreadView({
  thread: drawn,
  moved = false,
  className,
  onReply,
  onResolve,
}: {
  thread: ThreadData;
  className?: string;
  /** Shown at the top of the file rather than at its line (on the file, or a line no longer here). */
  moved?: boolean;
  onReply: (body: string) => Promise<void>;
  onResolve: (resolved: boolean) => Promise<void>;
}) {
  const t = useT();
  const api = useConversationApi();
  // As it is now: the diff draws a conversation again only when its comments come or go.
  const thread = api?.thread(drawn.id) ?? drawn;
  const [replying, setReplying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!thread.resolved);
  const [whole, setWhole] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await onResolve(!thread.resolved);
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <Box className={cn("py-2", className)}>
        <button type="button" className="flex w-full cursor-default items-center gap-2 rounded-sm text-left text-callout text-muted-foreground outline-none focus-ring" onClick={() => setOpen(true)}>
          <Check className="size-3.5 text-success" /> {t("review.resolvedConversation", { comments: t("common.comments", { count: thread.comments.length }) })}
        </button>
      </Box>
    );
  }
  // A long one: its start and its latest, the middle a click away.
  const folded = !whole && thread.comments.length > LONG_THREAD;
  const hidden = folded ? thread.comments.length - 4 : 0;
  const shown = folded ? [...thread.comments.slice(0, 1), null, ...thread.comments.slice(-3)] : thread.comments;
  return (
    <Box className={className}>
      {moved ? <p className="mb-2 text-callout text-muted-foreground">{thread.line ? t("review.onGoneLine", { line: String(thread.line) }) : t("review.onFile")}</p> : null}
      <div className="flex flex-col gap-3">
        {shown.map((c) =>
          c ? (
            <CommentView key={c.id} thread={thread} comment={c} onQuote={(text) => setReplying(quote(text))} />
          ) : (
            <Button key="more" variant="ghost" className="self-start text-link" onClick={() => setWhole(true)}>
              {t("review.showMoreReplies", { count: hidden })}
            </Button>
          ),
        )}
      </div>
      <div className="mt-3 border-t pt-3">
        {replying !== null ? (
          <Composer
            placeholder={t("review.reply")}
            submitLabel={t("review.reply")}
            initial={replying}
            onSubmit={async (body) => {
              await onReply(body);
              setReplying(null);
            }}
            // Like GitHub's "Start a review": the reply waits in your pending review.
            secondary={
              api
                ? {
                    label: t("review.addToReviewShort"),
                    onClick: (body) => {
                      api.replyLater(thread, body);
                      setReplying(null);
                    },
                  }
                : undefined
            }
            onCancel={() => setReplying(null)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setReplying("")}>
              <CornerDownRight /> {t("review.reply")}
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => void toggle()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : thread.resolved ? <Undo2 /> : <Check />}
              {thread.resolved ? t("review.unresolve") : t("review.resolve")}
            </Button>
          </div>
        )}
      </div>
    </Box>
  );
}

export function DraftView({ draft: drawn, onEdit, onRemove }: { draft: Draft; onEdit: (body: string) => void; onRemove: () => void }) {
  const t = useT();
  const api = useConversationApi();
  const draft = api?.draft(drawn.key) ?? drawn;
  const [editing, setEditing] = useState(false);
  const error = api?.draftError(draft.key);
  const sending = api?.draftSending(draft.key);
  return (
    <Box className="border-unread/40 bg-unread/5">
      {editing ? (
        <Composer
          placeholder={t("review.commentPlaceholder")}
          submitLabel={t("review.save")}
          initial={draft.body}
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-callout font-medium text-unread">
              {draft.replyTo ? t("review.pendingReply") : draft.file ? t("review.pendingOnFile") : t("review.pending")}
              {/* Where it is: on its way to your pending review on GitHub, or there. */}
              {error ? null : sending ? (
                <span className="flex items-center gap-1 font-normal text-muted-foreground" role="status">
                  <CloudUpload className="size-3.5" aria-hidden /> {t("review.savingToGitHub")}
                </span>
              ) : draft.id ? (
                <span className="font-normal text-muted-foreground">· {t("review.onGitHub")}</span>
              ) : null}
            </p>
            {draft.html && !sending ? (
              <CommentHtml html={draft.html} className="mt-1" />
            ) : (
              <p className="selectable mt-1 text-body whitespace-pre-wrap">{draft.body}</p>
            )}
            {error ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-callout text-destructive" role="alert">
                <AlertCircle className="size-3.5" aria-hidden /> {t("review.githubRefused", { reason: error })}
                <Button variant="link" size="xs" className="h-auto px-0" onClick={() => api?.retryDrafts()}>
                  {t("review.tryAgain")}
                </Button>
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("review.editComment")} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t("review.removeComment")} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      )}
    </Box>
  );
}

/** What opens on selected lines: a comment for the author (to your review, or posted now: either
 *  way it's on GitHub), or a question for your AI about what the code does. */
// The tab picked last is the one the next selection opens on.
const TAB = "selection-tab";
type Mode = "comment" | "ask";
function lastMode(): Mode {
  try {
    return localStorage.getItem(TAB) === "ask" ? "ask" : "comment";
  } catch {
    return "comment";
  }
}

/** One question about the selected lines, and what came back. */
type Turn = { question: string; answer?: string; note?: string };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The box for selected lines: a comment for the author (into your review, or posted now), or a
 *  conversation with the AI about them that you can keep going and turn into a comment. */
export function NewComment({
  lines,
  path,
  range,
  file = false,
  onAdd,
  onSendNow,
  onCancel,
  ask,
  askName,
}: {
  lines: string;
  /** The file and lines it's on, for a suggested change to start from them. */
  path?: string;
  range?: { start: number; end: number; side?: "additions" | "deletions"; endSide?: "additions" | "deletions" };
  /** On the file as a whole. */
  file?: boolean;
  onAdd: (body: string) => void;
  onSendNow: (body: string) => Promise<void>;
  onCancel: () => void;
  /** Null when no AI is set up. */
  ask: ((question: string, earlier: Exchange[]) => Promise<Answer>) | null;
  askName: string;
}) {
  const t = useT();
  const api = useConversationApi();
  // A suggested change goes on the new code's lines, as GitHub has it: those lines, from the patch.
  const patch = path ? api?.patchOf(path) : undefined;
  const side = range?.endSide ?? range?.side ?? "additions";
  const picked = range && patch && !file && side === "additions" ? linesFromPatch(patch, Math.min(range.start, range.end), Math.max(range.start, range.end), "additions") : null;
  const [mode, setModeState] = useState<Mode>(lastMode);
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLLIElement>(null);
  const tabs = useId();
  const asking = mode === "ask";

  const setMode = (next: Mode) => {
    setModeState(next);
    setError(null);
    try {
      localStorage.setItem(TAB, next);
    } catch {
      // Still switches for this box.
    }
  };

  useEffect(() => {
    field.current?.focus();
  }, [mode]);
  // The newest question and answer in view as they come (in braces: scrolling may return a promise).
  useEffect(() => {
    latest.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [turns]);

  const fail = (e: unknown) => setError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

  const comment = async (now: boolean) => {
    const text = body.trim();
    if (!text) return setError(i18n()("review.writeFirst"));
    setBusy(true);
    setError(null);
    try {
      if (now) await onSendNow(text);
      else onAdd(text);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const q = question.trim();
    if (!ask || !q || busy) return;
    const earlier = turns.flatMap((t) => (t.answer ? [{ question: t.question, answer: t.answer }] : []));
    setBusy(true);
    setError(null);
    setQuestion("");
    setTurns((list) => [...list, { question: q }]);
    try {
      const a = await ask(q, earlier);
      setTurns((list) => list.map((t, i) => (i === list.length - 1 ? { ...t, answer: a.text, note: a.note } : t)));
    } catch (e) {
      // The question goes back in the box to try again.
      setTurns((list) => list.slice(0, -1));
      setQuestion(q);
      fail(e);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  };

  const submit = () => void (asking ? send() : comment(false));

  return (
    <Box className="p-0">
      <div className="flex items-center gap-3 px-3 pt-3">
        {/* A segmented control in content: the chosen segment in the accent, as Tahoe draws it. */}
        <div role="tablist" onKeyDown={tabKeys} aria-label={t("review.onLines", { lines })} className="relative isolate flex rounded-(--radius-control) bg-fill">
          <SlidingPill selected={mode} className="rounded-(--radius-control-sm) bg-selected" />
          {(
            [
              ["comment", t("review.commentTab"), MessageSquare],
              ["ask", ask ? t("review.askTab", { name: askName }) : t("review.askAiTab"), Sparkles],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              data-pill={value}
              tabIndex={mode === value ? 0 : -1}
              id={`${tabs}-${value}`}
              aria-selected={mode === value}
              aria-controls={`${tabs}-panel`}
              onClick={() => setMode(value)}
              className={cn(
                "flex h-(--control-h) cursor-default items-center gap-1.5 rounded-(--radius-control-sm) px-2.5 text-body outline-none focus-ring",
                mode === value ? "text-selected-foreground" : "text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <span className="text-callout text-muted-foreground">{lines}</span>
      </div>

      <div role="tabpanel" id={`${tabs}-panel`} aria-labelledby={`${tabs}-${mode}`} className="flex flex-col gap-2 px-3 pt-2.5">
        {asking && turns.length ? (
          <ol aria-label={t("review.conversationWith", { name: askName })} className="-mx-3 flex max-h-[min(28rem,55vh)] flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-1">
            {turns.map((turn, i) => (
              <li key={i} ref={i === turns.length - 1 ? latest : undefined} className="flex flex-col gap-2">
                <p className="selectable max-w-[85%] self-end rounded-2xl rounded-br-md bg-muted px-3 py-1.5 text-body whitespace-pre-wrap animate-in fade-in-0 duration-(--duration) motion-reduce:animate-none">
                  <span className="sr-only">{t("review.you")}</span>
                  {turn.question}
                </p>
                <div className="flex gap-2.5">
                  <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-violet/15 text-violet">
                    <Sparkles className="size-3" />
                  </span>
                  {turn.answer ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                      <span className="sr-only">{askName}: </span>
                      <AiAnswer text={turn.answer} />
                      {turn.note ? <p className="text-subheadline text-muted-foreground">{turn.note}</p> : null}
                      <div>
                        <Button
                          variant="ghost"
                          className="-ml-2.5 text-muted-foreground"
                          onClick={() => {
                            setBody(turn.answer ?? "");
                            setMode("comment");
                          }}
                        >
                          <MessageSquare /> {t("review.turnIntoComment")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1" role="status">
                      <span className="sr-only">{t("review.readingCode", { name: askName })}</span>
                      <span aria-hidden className="h-3 w-11/12 rounded bg-muted" />
                      <span aria-hidden className="h-3 w-3/4 rounded bg-muted" />
                      <span aria-hidden className="h-3 w-1/2 rounded bg-muted" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        {asking && !ask ? (
          <p className="py-2 text-body text-muted-foreground">{t("review.setUpAi")}</p>
        ) : !asking ? (
          <MarkdownField
            value={body}
            onChange={setBody}
            label={t("review.commentLabel")}
            placeholder={t("review.commentForAuthor")}
            onSubmit={submit}
            onCancel={onCancel}
            suggestion={picked}
            base={picked ?? undefined}
          />
        ) : (
          <>
            <label htmlFor={`${tabs}-field`} className="sr-only">
              {asking ? t("review.questionLabel") : t("review.commentLabel")}
            </label>
            <Textarea
              id={`${tabs}-field`}
              ref={field}
              rows={asking ? 2 : 3}
              value={asking ? question : body}
              placeholder={asking ? (turns.length ? t("review.askFollowUp") : t("review.askAbout")) : t("review.commentForAuthor")}
              onChange={(e) => (asking ? setQuestion(e.target.value) : setBody(e.target.value))}
              onKeyDown={(e) => {
                // Asking is a chat: Enter sends, Shift+Enter breaks the line. A comment, like GitHub's: ⌘/Ctrl+Enter.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (asking && !e.shiftKey && !e.nativeEvent.isComposing))) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  onCancel();
                }
              }}
              className="resize-y"
            />
          </>
        )}
        {error ? (
          <p className="text-callout text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 p-3">
        <p className="mr-auto text-subheadline text-muted-foreground">
          {asking ? (ask ? t("review.askHint") : null) : t("review.commentHint", { shortcut: `${isMac ? "⌘" : "Ctrl+"}Enter` })}
        </p>
        <Button variant="outline" onClick={onCancel} disabled={busy && !asking}>
          {t("review.close")}
        </Button>
        {asking ? (
          ask ? (
            <Button onClick={submit} disabled={busy || !question.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t("review.ask")}
            </Button>
          ) : (
            <Button onClick={() => void bridge.openSettings()}>
              {t("review.openSettings")}
            </Button>
          )
        ) : (
          <>
            <Button variant="outline" onClick={() => void comment(true)} disabled={busy}>
              {t("review.postNow")}
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <MessageSquare />}
              {t("review.comment")}
            </Button>
          </>
        )}
      </div>
    </Box>
  );
}

/** A comment the AI suggests on a line: added to your review (where you can still edit it) or dismissed. */
export function FindingView({ finding, by, onAdd, onDismiss }: { finding: Finding; by: string; onAdd: () => void; onDismiss: () => void }) {
  const t = useT();
  return (
    <Box className="border-violet/40 bg-violet/5">
      <p className="flex items-center gap-1.5 text-callout font-medium text-violet">
        <Sparkles className="size-3.5" aria-hidden /> {by} · {t(`review.severity.${finding.severity}`)}
      </p>
      <div className="mt-1.5">
        <AiAnswer text={finding.body} />
      </div>
      <ButtonGroup className="mt-2.5">
        <Button variant="outline" onClick={onAdd}>
          {t("review.addToReview")}
        </Button>
        <Button variant="outline" onClick={onDismiss}>
          {t("review.dismiss")}
        </Button>
      </ButtonGroup>
    </Box>
  );
}
