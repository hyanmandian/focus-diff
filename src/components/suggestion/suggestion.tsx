// Committing suggested changes, as on GitHub: one at once ("Commit Suggestion"), or several gathered
// in a batch and committed together. Only offered when you can push to the pull request's branch,
// and only for suggestions that still apply (not outdated, resolved, or on removed lines).

import { GitCommitHorizontal, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/popover/popover";
import { Textarea } from "@/components/textarea/textarea";
import { defaultHeadline, type Applied } from "@/utils/commit/commit";
import { useT } from "@/utils/i18n/i18n";
import type { Thread, ThreadComment } from "@/utils/review/review";
import { suggestionsIn } from "@/utils/suggestion/suggestion";
import { useConversationApi } from "@/hooks/use-conversation/use-conversation";

/** Why a comment's suggestion can't be committed, if it can't. Their words: t(`review.cantApply.${why}`). */
function whyNot(thread: Thread, comment: ThreadComment, count: number) {
  if (comment.pending) return "pending";
  if (thread.resolved) return "resolved";
  if (thread.outdated || !thread.line) return "outdated";
  if (thread.side === "deletions") return "deleted";
  if (count > 1) return "several";
  return null;
}

/** The commit's message, then the commit: a popover from the button that opened it. */
function CommitPopover({ items, children, variant = "outline" }: { items: Applied[]; children: React.ReactNode; variant?: "outline" | "default" }) {
  const t = useT();
  const api = useConversationApi();
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commit = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      await api.commit(items, headline, body);
      setOpen(false);
      setHeadline("");
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant={variant} />}>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <PopoverTitle>{t("review.commitTitle", { count: items.length })}</PopoverTitle>
        <Input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder={defaultHeadline(items)}
          aria-label={t("review.commitHeadline")}
          onKeyDown={(e) => e.key === "Enter" && void commit()}
        />
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("review.commitBody")} aria-label={t("review.commitBody")} className="resize-y" />
        <p className="text-callout text-muted-foreground">{t("review.commitsTo", { branch: api?.branch ?? "" })}</p>
        {error ? (
          <p className="text-callout text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="self-end" onClick={() => void commit()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <GitCommitHorizontal />}
          {t("review.commitChanges")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Under a comment with a suggested change: commit it, or gather it for one commit with others. */
export function SuggestionActions({ thread, comment }: { thread: Thread; comment: ThreadComment }) {
  const t = useT();
  const api = useConversationApi();
  if (!api?.canApplySuggestion || !comment.body) return null;
  const blocks = suggestionsIn(comment.body);
  if (!blocks.length) return null;
  const why = whyNot(thread, comment, blocks.length);
  if (why) return <p className="mt-1.5 text-callout text-muted-foreground">{t(`review.cantApply.${why}`)}</p>;
  const item: Applied = {
    thread: thread.id,
    comment: comment.id,
    path: thread.path,
    start: thread.startLine ?? thread.line,
    end: thread.line,
    lines: blocks[0]!,
    author: { login: comment.author?.login ?? "", name: comment.author?.name, databaseId: comment.authorId },
  };
  const batched = api.batch.some((i) => i.comment === comment.id);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {batched ? null : <CommitPopover items={[item]}>{t("review.commitSuggestion")}</CommitPopover>}
      <Button variant="ghost" onClick={() => api.toggleBatch(item)}>
        {batched ? t("review.removeFromBatch") : t("review.addToBatch")}
      </Button>
      {batched ? (
        <CommitPopover items={api.batch} variant="default">
          {t("review.commitBatch", { count: api.batch.length })}
        </CommitPopover>
      ) : null}
    </div>
  );
}

/** The batch, over the diff's bottom corner (clear of the file headers and the filter bar) while
 *  it has suggestions in it: commit them all, or let them go. */
export function SuggestionBatch() {
  const t = useT();
  const api = useConversationApi();
  if (!api?.batch.length) return null;
  return (
    <div role="region" aria-label={t("review.batch")} className="absolute right-4 bottom-20 z-20 flex items-center gap-1 rounded-full bg-popover py-1 pr-1 pl-3 text-body shadow-(--shadow-menu)">
      <span className="text-muted-foreground tabular-nums">{t("review.inBatch", { count: api.batch.length })}</span>
      <CommitPopover items={api.batch} variant="default">
        {t("review.commitBatch", { count: api.batch.length })}
      </CommitPopover>
      <Button variant="ghost" size="icon-xs" aria-label={t("review.clearBatch")} onClick={api.clearBatch}>
        <X />
      </Button>
    </div>
  );
}
