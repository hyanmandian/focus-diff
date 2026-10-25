// What sits between a file's lines: a conversation (with replies and resolving), a comment written
// for this review, or the box to write one.

import { Check, CornerDownRight, Loader2, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Finding } from "@/lib/ai";
import { avatar } from "@/lib/avatar";
import { bridge } from "@/lib/bridge";
import { ago, firstName } from "@/lib/copy";
import type { Actor } from "@/lib/engine";
import type { Draft, Thread as ThreadData } from "@/lib/review";
import { sanitize } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
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
      className="text-[13px] leading-relaxed break-words [&_a]:text-unread [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
      onClick={(e) => {
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

export function NewComment({ lines, onAdd, onSendNow, onCancel }: { lines: string; onAdd: (body: string) => void; onSendNow: (body: string) => Promise<void>; onCancel: () => void }) {
  return (
    <Box>
      <p className="mb-2 text-xs text-muted-foreground">Comment on {lines}</p>
      <Composer placeholder="Leave a comment" submitLabel="Add to review" onSubmit={onAdd} onCancel={onCancel} secondary={{ label: "Comment now", onClick: onSendNow }} />
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
