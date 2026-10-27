// The merge box, as GitHub's: where the pull request stands, what stands in the way of merging it
// (reviews, checks, conversations, conflicts, an out-of-date branch), and what can be done: merge
// (with the commit message, editable), merge when ready (auto-merge), the merge queue, update the
// branch, bypass as an admin, delete the branch after. Merging asks first with a native alert.

import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  GitBranch,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/button/button";
import { Checkbox } from "@/components/checkbox/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/collapsible/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { Input } from "@/components/input/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";
import { Textarea } from "@/components/textarea/textarea";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { bridge } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import type { Details } from "@/utils/details/details";
import { useT } from "@/utils/i18n/i18n";
import { defaultMessage, type Method, type Reason } from "@/utils/merging/merging";

const STATUS_ICON = {
  merged: { icon: GitMerge, className: "bg-violet text-white" },
  closed: { icon: GitPullRequestClosed, className: "bg-destructive text-white" },
  draft: { icon: GitPullRequestDraft, className: "bg-muted text-muted-foreground" },
  queued: { icon: Clock, className: "bg-warning text-white" },
  auto: { icon: Clock, className: "bg-success text-white" },
  conflicts: { icon: CircleAlert, className: "bg-destructive text-white" },
  behind: { icon: GitBranch, className: "bg-warning text-white" },
  blocked: { icon: ShieldAlert, className: "bg-warning text-white" },
  unstable: { icon: CircleAlert, className: "bg-warning text-white" },
  checking: { icon: Loader2, className: "bg-muted text-muted-foreground" },
  ready: { icon: CircleCheck, className: "bg-success text-white" },
} as const;

const REASON_ICON: Record<Reason, { icon: typeof CircleX; className: string }> = {
  approvals: { icon: CircleDot, className: "text-warning" },
  changes: { icon: CircleX, className: "text-destructive" },
  codeOwners: { icon: CircleDot, className: "text-warning" },
  failing: { icon: CircleX, className: "text-destructive" },
  pending: { icon: CircleDot, className: "text-warning" },
  conversations: { icon: CircleDot, className: "text-warning" },
  behind: { icon: GitBranch, className: "text-warning" },
  conflicts: { icon: CircleAlert, className: "text-destructive" },
};

type Props = { details: Details; pull: Pull };

export function MergeBox({ details, pull }: Props) {
  const t = useT();
  const view = pull.view;
  const m = pull.manage;
  const [method, setMethod] = useState<Method | null>(null);
  const chosen = method && details.mergeMethods.includes(method) ? method : (details.mergeMethods[0] ?? null);
  // The commit message, as GitHub would write it, until it's edited (per method).
  const [edited, setEdited] = useState<Partial<Record<Method, { title: string; body: string }>>>({});
  const [bypass, setBypass] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  if (!view || !m) return null;
  const message = chosen ? (edited[chosen] ?? defaultMessage(chosen, m, details, pull.commits?.commits ?? [])) : null;
  const edit = (
    how: Method,
    from: { title: string; body: string },
    change: Partial<{ title: string; body: string }>,
  ) => {
    setEdited((e) => ({ ...e, [how]: { ...from, ...change } }));
  };
  const s = STATUS_ICON[view.status];
  const open = details.state === "OPEN";
  const merging = view.canMerge || (bypass && view.canBypass);
  const busy = pull.busy;
  const canDelete = m.headRefExists && m.viewerCanDeleteHeadRef;
  const detail =
    view.status === "queued" && m.queuePosition
      ? t("manage.queuePosition", { position: m.queuePosition })
      : view.status === "auto" && m.autoMerge
        ? t(`manage.autoMergeDetail.${m.autoMerge.method}`)
        : view.status === "merged" || view.status === "closed"
          ? canDelete
            ? t("manage.branchCanGo", { branch: details.headRefName })
            : t("manage.branchGone")
          : view.status === "behind"
            ? t("manage.behindDetail", { base: details.baseRefName })
            : view.status === "conflicts"
              ? t("manage.conflictsDetail")
              : view.status === "ready" || view.status === "unstable"
                ? m.isMergeQueueEnabled
                  ? t("manage.readyQueue")
                  : t("manage.readyDetail", { base: details.baseRefName })
                : null;
  return (
    <section aria-labelledby="merge-status" className="rounded-xl border bg-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", s.className)} aria-hidden>
          <s.icon className={cn("size-4", view.status === "checking" && "animate-spin motion-reduce:animate-none")} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="merge-status" className="text-headline font-bold">
            {t(`manage.status.${view.status}`)}
          </h2>
          {detail ? <p className="text-callout text-muted-foreground">{detail}</p> : null}
        </div>
        {view.canUpdateBranch ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="shrink-0 gap-1" disabled={busy === "update"} />}
            >
              {busy === "update" ? <Loader2 className="animate-spin" /> : null}
              {t("manage.updateBranch")}
              <ChevronDown className="size-3 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void pull.actions.updateBranch("MERGE")}>
                {t("manage.updateMerge")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void pull.actions.updateBranch("REBASE")}>
                {t("manage.updateRebase")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {view.status === "conflicts" ? (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void bridge.openUrl(`${details.url}/conflicts`)}
          >
            <ExternalLink /> {t("manage.resolveConflicts")}
          </Button>
        ) : null}
        {(view.status === "merged" || view.status === "closed") && canDelete ? (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void pull.actions.deleteBranch()}
            disabled={busy === "branch"}
          >
            {t("manage.deleteBranch")}
          </Button>
        ) : null}
        {view.status === "closed" && details.viewerCanUpdate ? (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void pull.actions.reopen()}
            disabled={busy === "close"}
          >
            {t("manage.reopen")}
          </Button>
        ) : null}
        {view.status === "draft" && details.viewerCanUpdate && open ? (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => void pull.actions.ready()}
            disabled={busy === "ready"}
          >
            {t("review.markReady")}
          </Button>
        ) : null}
      </div>

      {view.reasons.length > 0 && open && !details.isDraft ? (
        <ul className="flex flex-col gap-1 border-t px-4 py-2.5">
          {view.reasons.map((reason) => {
            const r = REASON_ICON[reason];
            return (
              <li key={reason} className="flex items-center gap-2 text-body">
                <r.icon className={cn("size-3.5 shrink-0", r.className)} aria-hidden />
                <span>
                  {reason === "approvals" && m.rule?.approvals
                    ? t("manage.reason.approvalsCount", { count: m.rule.approvals })
                    : reason === "conversations"
                      ? t("manage.reason.conversations", { count: pull.unresolved })
                      : t(`manage.reason.${reason}`)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {open &&
      chosen &&
      (merging ||
        view.canAutoMerge ||
        view.canEnqueue ||
        view.canDequeue ||
        view.canDisableAutoMerge ||
        view.canBypass) ? (
        <div className="flex flex-col gap-2.5 border-t px-4 py-3">
          {view.canBypass && !view.canMerge ? (
            <label className="flex items-center gap-2 text-body">
              <Checkbox checked={bypass} onCheckedChange={setBypass} className="size-3.5" /> {t("manage.bypass")}
            </label>
          ) : null}
          {(merging || view.canAutoMerge) && chosen !== "rebase" && message ? (
            <Collapsible>
              <CollapsibleTrigger className="flex cursor-default items-center gap-1 rounded text-callout text-muted-foreground focus-ring outline-none data-panel-open:[&_svg]:rotate-0">
                <ChevronDown
                  className="size-3 -rotate-90 transition-transform duration-(--duration-fast) motion-reduce:transition-none"
                  aria-hidden
                />{" "}
                {t("manage.commitMessage")}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-1.5 pt-2">
                  <Input
                    value={message.title}
                    onChange={(e) => {
                      edit(chosen, message, { title: e.target.value });
                    }}
                    aria-label={t("manage.commitTitle")}
                  />
                  <Textarea
                    rows={4}
                    value={message.body}
                    onChange={(e) => {
                      edit(chosen, message, { body: e.target.value });
                    }}
                    aria-label={t("manage.commitBody")}
                    className="resize-y font-mono text-callout"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {merging && canDelete && !m.deleteBranchOnMerge ? (
            <label className="flex items-center gap-2 text-body">
              <Checkbox checked={deleteAfter} onCheckedChange={setDeleteAfter} className="size-3.5" />{" "}
              {t("manage.deleteAfter")}
            </label>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {details.mergeMethods.length > 1 && (merging || view.canAutoMerge) ? (
              <Select value={chosen} onValueChange={setMethod}>
                <SelectTrigger aria-label={t("manage.mergeMethod")}>
                  <SelectValue>{(v: Method) => t(`review.mergeMethod.${v}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {details.mergeMethods.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`review.mergeMethod.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {view.canDisableAutoMerge ? (
              <Button variant="outline" onClick={() => void pull.actions.disableAutoMerge()} disabled={busy === "auto"}>
                {t("manage.disableAutoMerge")}
              </Button>
            ) : null}
            {view.canDequeue ? (
              <Button variant="outline" onClick={() => void pull.actions.dequeue()} disabled={busy === "queue"}>
                {t("manage.dequeue")}
              </Button>
            ) : null}
            {view.canEnqueue ? (
              <Button onClick={() => void pull.actions.enqueue()} disabled={busy === "queue"}>
                {busy === "queue" ? <Loader2 className="animate-spin" /> : null}
                {t("manage.enqueue")}
              </Button>
            ) : null}
            {merging ? (
              <Button
                variant={bypass && !view.canMerge ? "destructive" : "default"}
                onClick={() =>
                  void pull.actions.merge(chosen, chosen === "rebase" ? undefined : message!, {
                    bypass: bypass && !view.canMerge,
                    deleteAfter,
                  })
                }
                disabled={busy === "merge"}
              >
                {busy === "merge" ? <Loader2 className="animate-spin" /> : <GitMerge />}
                {t(`review.mergeMethod.${chosen}`)}
              </Button>
            ) : view.canAutoMerge ? (
              <Button
                onClick={() => void pull.actions.autoMerge(chosen, chosen === "rebase" ? undefined : message!)}
                disabled={busy === "auto"}
              >
                {busy === "auto" ? <Loader2 className="animate-spin" /> : null}
                {t("manage.enableAutoMerge")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
