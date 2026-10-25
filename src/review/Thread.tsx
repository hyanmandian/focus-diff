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
import { ago, firstName } from "@/lib/copy";
import type { Actor } from "@/lib/engine";
import type { Draft, Thread as ThreadData } from "@/lib/review";
import { useDiagrams } from "@/lib/diagrams";
import { sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { openViewer } from "@/shared/Viewer";
import { SlidingPill } from "@/shared/SlidingPill";
import { AiAnswer } from "@/shared/AiAnswer";

function Person({ actor }: { actor: Actor }) {
  return (
    <Avatar className="size-5">
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-[9px]">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
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
      className="text-[13px] leading-relaxed break-words [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_video]:my-2 [&_video]:max-h-[60vh] [&_video]:max-w-full [&_video]:rounded-lg [&_a]:text-unread [&_a]:underline [&_a]:decoration-unread/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-unread [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
      onClick={(e) => {
        // A picture opens in the viewer (even one GitHub wrapped in a link to itself).
        const picture = (e.target as Element).closest("img");
        if (picture) {
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
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => ref.current?.focus(), []);
  const run = async (action: (body: string) => Promise<void> | void) => {
    if (!body.trim()) return setError("Write something first.");
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
        className="resize-y text-[13px]"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
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
  <div className={cn("mx-3 my-2 max-w-3xl rounded-xl border bg-card p-3 font-sans text-card-foreground shadow-sm", className)}>{children}</div>
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
        <button type="button" className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline" onClick={() => setOpen(true)}>
          <Check className="size-3.5 text-success" /> Resolved conversation · {thread.comments.length} {thread.comments.length === 1 ? "comment" : "comments"} · show
        </button>
      </Box>
    );
  }
  return (
    <Box className={className}>
      {moved ? <p className="mb-2 text-xs text-muted-foreground">{thread.line ? `On line ${thread.line}, which this diff no longer shows` : "On the file"}</p> : null}
      <div className="flex flex-col gap-3">
        {thread.comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Person actor={c.author} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{firstName(c.author)}</span> · {ago(Date.parse(c.at))}
                {thread.outdated ? " · outdated" : ""}
              </p>
              <Html html={c.html} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t pt-3">
        {replying ? (
          <Composer
            placeholder="Reply"
            submitLabel="Reply"
            onSubmit={async (body) => {
              await onReply(body);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
              <CornerDownRight /> Reply
            </Button>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void toggle()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : thread.resolved ? <Undo2 /> : <Check />}
              {thread.resolved ? "Unresolve" : "Resolve"}
            </Button>
          </div>
        )}
      </div>
    </Box>
  );
}

export function DraftView({ draft, onEdit, onRemove }: { draft: Draft; onEdit: (body: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <Box className="border-unread/40 bg-unread/5">
      {editing ? (
        <Composer
          placeholder="Comment"
          submitLabel="Save"
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
            <p className="text-xs font-medium text-unread">Pending · sent with your review</p>
            <p className="mt-1 text-[13px] whitespace-pre-wrap">{draft.body}</p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Edit comment" onClick={() => setEditing(true)}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Remove comment" onClick={onRemove}>
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

const isMac = navigator.userAgent.includes("Mac");
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
    if (!text) return setError("Write something first.");
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
        <div role="tablist" onKeyDown={tabKeys} aria-label={`On ${lines}`} className="relative isolate flex gap-1 rounded-lg bg-muted p-0.5">
          <SlidingPill selected={mode} className="bg-background shadow-sm" />
          {(
            [
              ["comment", "Comment", MessageSquare],
              ["ask", `Ask ${askName}`, Sparkles],
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
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                mode === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{lines}</span>
      </div>

      <div role="tabpanel" id={`${tabs}-panel`} aria-labelledby={`${tabs}-${mode}`} className="flex flex-col gap-2 px-3 pt-2.5">
        {asking && turns.length ? (
          <ol aria-label={`Conversation with ${askName}`} className="-mx-3 flex max-h-[min(28rem,55vh)] flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-1">
            {turns.map((t, i) => (
              <li key={i} ref={i === turns.length - 1 ? latest : undefined} className="flex flex-col gap-2">
                <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-muted px-3 py-1.5 text-[13px] whitespace-pre-wrap animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none">
                  <span className="sr-only">You: </span>
                  {t.question}
                </p>
                <div className="flex gap-2.5">
                  <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-violet/15 text-violet">
                    <Sparkles className="size-3" />
                  </span>
                  {t.answer ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 animate-in fade-in-0 duration-300 motion-reduce:animate-none">
                      <span className="sr-only">{askName}: </span>
                      <AiAnswer text={t.answer} />
                      {t.note ? <p className="text-[11px] text-muted-foreground">{t.note}</p> : null}
                      <div>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="-ml-2 text-muted-foreground"
                          onClick={() => {
                            setBody(t.answer ?? "");
                            setMode("comment");
                          }}
                        >
                          <MessageSquare /> Turn into a comment
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1" role="status">
                      <span className="sr-only">{askName} is reading the code…</span>
                      <span aria-hidden className="h-3 w-11/12 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                      <span aria-hidden className="h-3 w-3/4 animate-pulse rounded bg-muted [animation-delay:150ms] motion-reduce:animate-none" />
                      <span aria-hidden className="h-3 w-1/2 animate-pulse rounded bg-muted [animation-delay:300ms] motion-reduce:animate-none" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        {asking && !ask ? (
          <p className="py-2 text-[13px] text-muted-foreground">Set up Claude Code or Cursor in Settings to ask about code here.</p>
        ) : (
          <>
            <label htmlFor={`${tabs}-field`} className="sr-only">
              {asking ? "Your question about these lines" : "Your comment for the author"}
            </label>
            <Textarea
              id={`${tabs}-field`}
              ref={field}
              rows={asking ? 2 : 3}
              value={asking ? question : body}
              placeholder={asking ? (turns.length ? "Ask a follow-up…" : "Ask about these lines…") : "Comment for the author: what to change, or a question"}
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
              className="resize-y text-[13px]"
            />
          </>
        )}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 p-3">
        <p className="mr-auto text-[11px] text-muted-foreground">
          {asking ? (ask ? <>Enter to ask · Shift+Enter for a new line</> : null) : <>Goes into your review · {isMac ? "⌘" : "Ctrl+"}Enter</>}
        </p>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy && !asking}>
          Close
        </Button>
        {asking ? (
          ask ? (
            <Button size="sm" onClick={submit} disabled={busy || !question.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Ask
            </Button>
          ) : (
            <Button size="sm" onClick={() => void bridge.openSettings()}>
              Open Settings
            </Button>
          )
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => void comment(true)} disabled={busy}>
              Post now
            </Button>
            <Button size="sm" onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <MessageSquare />}
              Comment
            </Button>
          </>
        )}
      </div>
    </Box>
  );
}

const SEVERITY = { issue: "Issue", suggestion: "Suggestion", question: "Question" } as const;

/** A comment the AI suggests on a line: added to your review (where you can still edit it) or dismissed. */
export function FindingView({ finding, by, onAdd, onDismiss }: { finding: Finding; by: string; onAdd: () => void; onDismiss: () => void }) {
  return (
    <Box className="border-violet/40 bg-violet/5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-violet">
        <Sparkles className="size-3.5" aria-hidden /> {by} · {SEVERITY[finding.severity]}
      </p>
      <div className="mt-1.5">
        <AiAnswer text={finding.body} />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="xs" variant="outline" onClick={onAdd}>
          Add to my review
        </Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Box>
  );
}
