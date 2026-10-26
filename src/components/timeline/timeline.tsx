// One event of the timeline in the conversation, compact: a small glyph, who did what, and when,
// in one line (a run of commits opens to list them).

import { Bookmark, CircleDot, Eye, EyeOff, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequestClosed, GitPullRequestDraft, Link2, ListOrdered, Pencil, Rocket, Tag, Upload, UserMinus, UserPlus, Zap, ZapOff, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { bridge } from "@/utils/bridge/bridge";
import { useT, type T } from "@/utils/i18n/i18n";
import type { TimelineEvent } from "@/utils/timeline/timeline";
import { cn } from "@/utils/cn/cn";
import { LabelChip } from "@/components/sidebar/sidebar";

const ICON: Record<TimelineEvent["kind"], LucideIcon> = {
  commits: GitCommitHorizontal,
  forcePushed: Upload,
  reviewRequested: Eye,
  reviewRequestRemoved: EyeOff,
  labels: Tag,
  renamed: Pencil,
  ready: Eye,
  draft: GitPullRequestDraft,
  closed: GitPullRequestClosed,
  reopened: CircleDot,
  merged: GitMerge,
  referenced: Link2,
  commitReferenced: Link2,
  deployed: Rocket,
  assigned: UserPlus,
  unassigned: UserMinus,
  milestoned: Bookmark,
  demilestoned: Bookmark,
  reviewDismissed: EyeOff,
  autoMergeEnabled: Zap,
  autoMergeDisabled: ZapOff,
  queued: ListOrdered,
  dequeued: ListOrdered,
  branchDeleted: GitBranch,
  branchRestored: GitBranch,
  baseChanged: GitBranch,
};

/** The event in words, its name first: "ana added 3 commits". */
export function describe(e: TimelineEvent, t: T): string {
  const who = e.actor ?? t("common.someone");
  switch (e.kind) {
    case "commits":
      return t("manage.event.commits", { who, count: e.commits.length });
    case "forcePushed":
      return t("manage.event.forcePushed", { who, ref: e.ref, from: e.before ?? "?", to: e.after ?? "?" });
    case "reviewRequested":
    case "reviewRequestRemoved":
      return t(`manage.event.${e.kind}`, { who, reviewer: e.reviewer });
    case "labels":
      return e.added.length && e.removed.length ? t("manage.event.labelsBoth", { who }) : e.added.length ? t("manage.event.labelsAdded", { who }) : t("manage.event.labelsRemoved", { who });
    case "renamed":
      return t("manage.event.renamed", { who, from: e.from, to: e.to });
    case "merged":
      return t("manage.event.merged", { who, commit: e.commit ?? "", into: e.into });
    case "referenced":
      return t(e.willClose ? "manage.event.willClose" : "manage.event.referenced", { who, what: `${e.repo}#${e.number}`, title: e.title });
    case "commitReferenced":
      return t("manage.event.commitReferenced", { who, commit: e.commit, headline: e.headline });
    case "deployed":
      return t("manage.event.deployed", { who, environment: e.environment });
    case "assigned":
    case "unassigned":
      return e.assignee === e.actor ? t(`manage.event.${e.kind}Self`, { who }) : t(`manage.event.${e.kind}`, { who, assignee: e.assignee });
    case "milestoned":
    case "demilestoned":
      return t(`manage.event.${e.kind}`, { who, milestone: e.milestone });
    case "reviewDismissed":
      return t("manage.event.reviewDismissed", { who, reviewer: e.reviewer ?? t("common.someone") });
    case "baseChanged":
      return t("manage.event.baseChanged", { who, from: e.from, to: e.to });
    default:
      return t(`manage.event.${e.kind}`, { who });
  }
}

const TONE: Partial<Record<TimelineEvent["kind"], string>> = { merged: "text-violet", closed: "text-destructive", reopened: "text-success", ready: "text-success" };

export function TimelineRow({ event: e }: { event: TimelineEvent }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const Icon = ICON[e.kind];
  const link = e.kind === "referenced" || e.kind === "commitReferenced" ? e.url : null;
  const text = describe(e, t);
  return (
    <div className="flex gap-2.5 pl-1.5 text-callout text-muted-foreground">
      <span className="grid size-4 shrink-0 translate-y-px place-items-center">
        <Icon className={cn("size-3.5", TONE[e.kind])} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {link?.startsWith("https://") ? (
            <button type="button" className="cursor-default text-left outline-none hover:text-foreground focus-ring" onClick={() => void bridge.openUrl(link)}>
              {text}
            </button>
          ) : e.kind === "commits" && e.commits.length > 1 ? (
            <button type="button" aria-expanded={open} className="cursor-default text-left outline-none hover:text-foreground focus-ring" onClick={() => setOpen(!open)}>
              {text}
            </button>
          ) : (
            <span>{text}</span>
          )}
          {e.kind === "commits" && e.commits.length === 1 ? <span className="truncate text-foreground">{e.commits[0]!.headline}</span> : null}
          {e.kind === "labels" ? [...e.added, ...e.removed].map((l, i) => <LabelChip key={`${i}:${l.name}`} label={l} className={cn("h-4.5", e.removed.includes(l) && "line-through opacity-70")} />) : null}
          <span aria-hidden>·</span>
          <time dateTime={e.at}>{t.since(Date.parse(e.at))}</time>
        </p>
        {e.kind === "commits" && open ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {e.commits.map((c) => (
              <li key={c.oid} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-foreground">{c.headline}</span>
                <span className="shrink-0 font-mono text-subheadline">{c.short}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
