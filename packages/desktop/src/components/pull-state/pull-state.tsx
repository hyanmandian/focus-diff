import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";

import { Badge } from "@/components/badge/badge";
import { cn } from "@/utils/cn/cn";
import type { Details } from "@/utils/details/details";
import { useT } from "@/utils/i18n/i18n";

const STATES = {
  OPEN: { icon: GitPullRequest, className: "bg-success/12 text-success" },
  DRAFT: { icon: GitPullRequestDraft, className: "bg-secondary text-secondary-foreground" },
  CLOSED: { icon: GitPullRequestClosed, className: "bg-destructive/10 text-destructive dark:bg-destructive/20" },
  MERGED: { icon: GitMerge, className: "bg-violet/12 text-violet" },
} as const;

export function PullState({
  details,
  className,
}: {
  details: Pick<Details, "state" | "isDraft">;
  className?: string | undefined;
}) {
  const t = useT();
  const state = details.state === "OPEN" && details.isDraft ? "DRAFT" : details.state;
  const { icon: Icon, className: tone } = STATES[state];
  return (
    <Badge variant="ghost" data-state={state.toLowerCase()} className={cn("h-5 px-2", tone, className)}>
      <Icon aria-hidden />
      {t(`review.state.${state}`)}
    </Badge>
  );
}
