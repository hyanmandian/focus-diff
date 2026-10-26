// What sits between a file's lines: a conversation (with replies and resolving), a comment written
// for this review, or the box to write one.

import { Check, CornerDownRight, Loader2, MessageSquare, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Exchange, Finding } from "@/lib/ai";
import type { AiAnswer as Answer } from "@/lib/bridge";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import { firstName } from "@/lib/copy";
import { i18n, useT } from "@/lib/i18n";
import type { Actor } from "@/lib/engine";
import type { Draft, Thread as ThreadData } from "@/lib/review";
import { useDiagrams } from "@/lib/diagrams";
import { leadsElsewhere, sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { isMac } from "@/lib/platform";
import { openViewer } from "@/shared/Viewer";
import { SlidingPill } from "@/shared/SlidingPill";
import { AiAnswer } from "@/shared/AiAnswer";

function Person({ actor }: { actor: Actor }) {
  return (
    <Avatar className="size-5">
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-footnote">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function Html({ html }: { html: string }) {
  const clean = sanitize(html);
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, clean);
  return (
    <div
      ref={ref}
      className="selectable text-body leading-(--type-reading-leading) break-words [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_video]:my-2 [&_video]:max-h-[60vh] [&_video]:max-w-full [&_video]:rounded-lg [&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-callout [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
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
      // Sanitized: an allowlist of tags and attributes, https links and GitHub images only.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/** A box to write in: ⌘/Ctrl+Enter sends, Esc cancels. */
export function Composer({
  placeholder,
  submitLabel,
  initial = "",
  onSubmit,
  onCancel,
  secondary,
}: {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (body: string) => Promise<void> | void;
  onCancel: () => void;
  secondary?: { label: string; onClick: (body: string) => Promise<void> | void };
}) {
  const t = useT();
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => ref.current?.focus(), []);
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
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <Textarea
        id={id}
        ref={ref}
        rows={3}
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void run(onSubmit);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        className="resize-y"
      />
      {error ? (
        <p className="text-callout text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        {secondary ? (
          <Button variant="outline" size="sm" onClick={() => void run(secondary.onClick)} disabled={busy}>
            {secondary.label}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void run(onSubmit)} disabled={busy}>
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

export function ThreadView({
  thread,
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
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!thread.resolved);
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
  return (
    <Box className={className}>
      {moved ? <p className="mb-2 text-callout text-muted-foreground">{thread.line ? t("review.onGoneLine", { line: String(thread.line) }) : t("review.onFile")}</p> : null}
      <div className="flex flex-col gap-3">
        {thread.comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Person actor={c.author} />
            <div className="min-w-0 flex-1">
              <p className="text-callout text-muted-foreground">
                <span className="font-medium text-foreground">{firstName(c.author, t)}</span> · {t.since(Date.parse(c.at))}
                {thread.outdated ? ` · ${t("review.outdated")}` : ""}
              </p>
              <Html html={c.html} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t pt-3">
        {replying ? (
          <Composer
            placeholder={t("review.reply")}
            submitLabel={t("review.reply")}
            onSubmit={async (body) => {
              await onReply(body);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
              <CornerDownRight /> {t("review.reply")}
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void toggle()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : thread.resolved ? <Undo2 /> : <Check />}
              {thread.resolved ? t("review.unresolve") : t("review.resolve")}
            </Button>
          </div>
        )}
      </div>
    </Box>
  );
}

export function DraftView({ draft, onEdit, onRemove }: { draft: Draft; onEdit: (body: string) => void; onRemove: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
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
            <p className="text-callout font-medium text-unread">{t("review.pending")}</p>
            <p className="selectable mt-1 text-body whitespace-pre-wrap">{draft.body}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t("review.editComment")} onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("review.removeComment")} onClick={onRemove}>
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
  onAdd,
  onSendNow,
  onCancel,
  ask,
  askName,
}: {
  lines: string;
  onAdd: (body: string) => void;
  onSendNow: (body: string) => Promise<void>;
  onCancel: () => void;
  /** Null when no AI is set up. */
  ask: ((question: string, earlier: Exchange[]) => Promise<Answer>) | null;
  askName: string;
}) {
  const t = useT();
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
                          size="xs"
                          variant="ghost"
                          className="-ml-2 text-muted-foreground"
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
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy && !asking}>
          {t("review.close")}
        </Button>
        {asking ? (
          ask ? (
            <Button size="sm" onClick={submit} disabled={busy || !question.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {t("review.ask")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => void bridge.openSettings()}>
              {t("review.openSettings")}
            </Button>
          )
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => void comment(true)} disabled={busy}>
              {t("review.postNow")}
            </Button>
            <Button size="sm" onClick={submit} disabled={busy}>
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
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="xs" variant="outline" onClick={onAdd}>
          {t("review.addToReview")}
        </Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          {t("review.dismiss")}
        </Button>
      </div>
    </Box>
  );
}
