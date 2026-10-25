// What sits between a file's lines: a conversation (with replies and resolving), a comment written
// for this review, or the box to write one.

import { Check, CornerDownRight, Loader2, MessageSquare, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Finding } from "@/lib/ai";
import type { AiAnswer as Answer } from "@/lib/bridge";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import { ago, firstName } from "@/lib/copy";
import type { Actor } from "@/lib/engine";
import type { Draft, Thread as ThreadData } from "@/lib/review";
import { sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { openViewer } from "@/shared/Viewer";
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
  return (
    <div
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
      dangerouslySetInnerHTML={{ __html: sanitize(html) }}
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

export function ThreadView({ thread, onReply, onResolve }: { thread: ThreadData; onReply: (body: string) => Promise<void>; onResolve: (resolved: boolean) => Promise<void> }) {
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
      <Box className="py-2">
        <button type="button" className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline" onClick={() => setOpen(true)}>
          <Check className="size-3.5 text-success" /> Resolved conversation · {thread.comments.length} {thread.comments.length === 1 ? "comment" : "comments"} · show
        </button>
      </Box>
    );
  }
  return (
    <Box>
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
  ask: ((question: string) => Promise<Answer>) | null;
  askName: string;
}) {
  const [mode, setMode] = useState<"comment" | "ask">("comment");
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ phase: "busy" } | { phase: "done"; text: string; note?: string } | { phase: "error"; text: string } | null>(null);
  const tabs = useId();
  const run = async (q: string) => {
    if (!ask || !q.trim()) return;
    setAnswer({ phase: "busy" });
    try {
      const a: Answer = await ask(q.trim());
      setAnswer({ phase: "done", text: a.text, note: a.note });
    } catch (e) {
      setAnswer({ phase: "error", text: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Box>
      <div className="mb-2 flex items-center gap-3">
        <div role="tablist" onKeyDown={tabKeys} aria-label={`On ${lines}`} className="flex gap-1 rounded-lg bg-muted p-0.5">
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
              tabIndex={mode === value ? 0 : -1}
              id={`${tabs}-${value}`}
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                mode === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{lines}</span>
      </div>
      {mode === "comment" ? (
        <div role="tabpanel" aria-labelledby={`${tabs}-comment`}>
          <Composer
            key={draft}
            placeholder="Comment for the author: what to change, or a question"
            submitLabel="Add to review"
            initial={draft}
            onSubmit={onAdd}
            onCancel={onCancel}
            secondary={{ label: "Comment now", onClick: onSendNow }}
          />
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby={`${tabs}-ask`} className="flex flex-col gap-2">
          {ask ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {["What does this do?", "Could this break anything?", "Is there a simpler way?"].map((q) => (
                  <Button key={q} variant="outline" size="xs" disabled={answer?.phase === "busy"} onClick={() => void run(q)}>
                    {q}
                  </Button>
                ))}
              </div>
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(question);
                }}
              >
                <Input autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about these lines…" aria-label="Your question about these lines" className="h-8 text-[13px]" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
                <Button type="submit" size="sm" variant="secondary" disabled={!question.trim() || answer?.phase === "busy"}>
                  Ask
                </Button>
              </form>
              <div aria-live="polite">
                {answer?.phase === "busy" ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading the code…
                  </p>
                ) : answer?.phase === "error" ? (
                  <p className="text-xs text-destructive" role="alert">
                    {answer.text}
                  </p>
                ) : answer?.phase === "done" ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-violet/30 bg-violet/5 p-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
                    <AiAnswer text={answer.text} />
                    {answer.note ? <p className="text-[11px] text-muted-foreground">{answer.note}</p> : null}
                    <div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setDraft(answer.text);
                          setMode("comment");
                        }}
                      >
                        <MessageSquare /> Turn into a comment
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Set up Claude Code or Cursor to ask about code here.</span>
              <Button size="xs" variant="outline" onClick={() => void bridge.openSettings()}>
                Open Settings
              </Button>
            </div>
          )}
        </div>
      )}
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
