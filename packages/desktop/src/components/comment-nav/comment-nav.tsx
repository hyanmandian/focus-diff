// The comments to step through, in the floating bar as the extension has them: a button with the
// count that opens a card over it, with the file and line of the one you're on, what kind it is,
// where it is in the list and arrows to the one before and after. The card stays open while you
// step (n and p from the keyboard do the same with it closed).

import { ChevronLeft, ChevronRight, MessageSquare, PencilLine, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/button/button";
import { Kbd } from "@/components/kbd/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";

/** A comment to step to: an open conversation, one of your pending comments, or the AI's. */
export type CommentStop = { path: string; line: number; kind: "conversation" | "pending" | "ai" };

const KIND = {
  conversation: { icon: MessageSquare, label: "review.stopConversation", tone: "text-warning" },
  pending: { icon: PencilLine, label: "review.stopPending", tone: "text-unread" },
  ai: { icon: Sparkles, label: "review.stopAi", tone: "text-violet" },
} as const;

type Props = {
  stops: CommentStop[];
  /** The one stepped to last, from 0; -1 before the first step. */
  stop: number;
  onStep: (by: 1 | -1) => void;
};

export function CommentNav({ stops, stop, onStep }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const total = stops.length;
  const index = stops[stop] ? stop : 0;
  const at = stops[index];
  const kind = at ? KIND[at.kind] : null;
  const name = at ? at.path.slice(at.path.lastIndexOf("/") + 1) : "";
  const where = total ? t("common.comments", { count: total }) : t("review.noOpenComments");

  return (
    <Popover
      open={open && total > 0}
      onOpenChange={(next) => {
        if (next && total === 0) return;
        setOpen(next);
        // Opening lands on a comment straight away, so the card always has one to show.
        if (next && stop < 0) onStep(1);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-8 shrink-0 gap-1.5 rounded-[8px] pr-2 pl-2.5 text-muted-foreground aria-expanded:bg-foreground/6 aria-expanded:text-foreground"
                  // Without comments it stays in place, so the bar keeps its shape, and says why.
                  aria-disabled={total === 0}
                  aria-label={`${t("review.comments")}, ${where}`}
                  aria-keyshortcuts="N P"
                />
              }
            />
          }
        >
          <MessageSquare />
          <span className="min-w-5 rounded-full bg-foreground/10 px-1.5 text-center text-subheadline leading-[18px] font-semibold tabular-nums">
            {total}
          </span>
        </TooltipTrigger>
        <TooltipContent>{total ? t("review.comments") : t("review.noOpenComments")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={10}
        className="w-[min(288px,calc(100vw-2rem))] rounded-[12px] p-2 pl-3"
        aria-label={t("review.comments")}
      >
        {at && kind ? (
          <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5">
            <kind.icon className={cn("row-span-2 size-4", kind.tone)} aria-hidden />
            <span className="flex min-w-0 text-body leading-5 font-semibold" title={at.path}>
              <span className="truncate">{name}</span>
              <span className="shrink-0 font-normal text-muted-foreground">:{at.line}</span>
            </span>
            <span
              className="text-center text-subheadline leading-4 font-semibold text-muted-foreground tabular-nums"
              aria-live="polite"
              aria-label={t("review.commentOf", { index: index + 1, total })}
            >
              {index + 1}/{total}
            </span>
            <span className="truncate text-callout leading-[18px] text-muted-foreground">{t(kind.label)}</span>
            <span className="flex items-center">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("review.previousComment")}
                      onClick={() => {
                        onStep(-1);
                      }}
                    />
                  }
                >
                  <ChevronLeft />
                </TooltipTrigger>
                <TooltipContent>
                  {t("review.previousCommentTip")} <Kbd>p</Kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("review.nextComment")}
                      onClick={() => {
                        onStep(1);
                      }}
                    />
                  }
                >
                  <ChevronRight />
                </TooltipTrigger>
                <TooltipContent>
                  {t("review.nextCommentTip")} <Kbd>n</Kbd>
                </TooltipContent>
              </Tooltip>
            </span>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
