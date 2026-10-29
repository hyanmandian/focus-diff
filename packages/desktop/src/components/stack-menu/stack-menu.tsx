import { Layers } from "lucide-react";

import { Button } from "@/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import type { Stack } from "@/hooks/use-stack/use-stack";
import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";
import type { StackPull } from "@/utils/stack/stack";

const STANDING = {
  APPROVED: "text-success",
  CHANGES_REQUESTED: "text-destructive",
  REVIEW_REQUIRED: "text-muted-foreground",
} as const;

export function Standing({ pull, className }: { pull: StackPull; className?: string }) {
  const t = useT();
  const standing = pull.decision ?? "REVIEW_REQUIRED";
  return (
    <span
      className={cn(
        "shrink-0 text-subheadline",
        pull.isDraft ? "text-muted-foreground" : STANDING[standing],
        className,
      )}
    >
      {pull.isDraft ? t("review.stackDraft") : t(`review.stackStanding.${standing}`)}
    </span>
  );
}

export function StackMenu({
  stack,
  className,
  onPick,
}: {
  stack: Stack;
  className?: string;
  onPick: (pull: StackPull) => void;
}) {
  const t = useT();
  const here = stack.pulls[stack.at];
  const position = t("review.stackPosition", { index: String(stack.at + 1), total: String(stack.pulls.length) });
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className={cn(className, "gap-1.5 bg-fill tabular-nums")}
                  aria-label={position}
                />
              }
            />
          }
        >
          <Layers />
          {stack.at + 1}/{stack.pulls.length}
        </TooltipTrigger>
        <TooltipContent>{position}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-96">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("review.stack")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={here?.id}
            onValueChange={(id: string) => {
              const pull = stack.pulls.find((p) => p.id === id);
              if (pull && pull.id !== here?.id) onPick(pull);
            }}
          >
            {stack.pulls.map((pull, i) => (
              <DropdownMenuRadioItem key={pull.id} value={pull.id} className="gap-2">
                <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground tabular-nums">#{pull.number}</span> {pull.title}
                </span>
                <Standing pull={pull} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
