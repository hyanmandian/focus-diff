import { Copy, MoreHorizontal, Pencil, Quote, SmilePlus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { useConversationApi } from "@/hooks/use-conversation/use-conversation";
import { cn } from "@/utils/cn/cn";
import { EMOJI, REACTIONS, toggled, type Reaction, type ReactionContent } from "@/utils/comments/comments";
import { useT } from "@/utils/i18n/i18n";

export function useReactions(subject: string, given: Reaction[]) {
  const api = useConversationApi();
  const [mine, setMine] = useState<Reaction[] | null>(null);
  const reactions = mine ?? given;
  const toggle = (content: ReactionContent) => {
    if (!api) return;
    const on = !reactions.find((r) => r.content === content)?.mine;
    const after = toggled(reactions, content, api.me);
    setMine(after);
    void (async () => {
      try {
        await api.react(subject, content, on, after);
      } catch {}
      setMine(null);
    })();
  };
  return [reactions, toggle] as const;
}

export function ReactionPicker({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle: (content: ReactionContent) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t("review.addReaction")}
                />
              }
            />
          }
        >
          <SmilePlus />
        </TooltipTrigger>
        <TooltipContent>{t("review.addReaction")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="w-auto flex-row gap-0.5 p-1.5">
        {REACTIONS.map((content) => {
          const mine = reactions.some((r) => r.content === content && r.mine);
          return (
            <button
              key={content}
              type="button"
              aria-label={t(`review.reaction.${content}`)}
              aria-pressed={mine}
              onClick={() => {
                onToggle(content);
                setOpen(false);
              }}
              className={cn(
                "grid size-8 cursor-default place-items-center rounded-(--radius-control) text-title3 focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-fill active:bg-(--fill-control-pressed)",
                mine && "bg-primary/15",
              )}
            >
              {EMOJI[content]}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function ReactionList({
  reactions,
  canReact,
  onToggle,
}: {
  reactions: Reaction[];
  canReact: boolean;
  onToggle: (content: ReactionContent) => void;
}) {
  const t = useT();
  if (reactions.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={t("review.reactions")}>
      {reactions.map((r) => {
        const others = r.count - r.who.length;
        const who = t.list([...r.who, ...(others > 0 ? [t("review.othersReacted", { count: others })] : [])]);
        const label = t("review.reactedWith", { who, reaction: t(`review.reaction.${r.content}`) });
        return (
          <li key={r.content}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-pressed={r.mine}
                    aria-label={t("review.reactionButton", {
                      count: r.count,
                      who,
                      reaction: t(`review.reaction.${r.content}`),
                    })}
                    disabled={!canReact}
                    onClick={() => {
                      onToggle(r.content);
                    }}
                    className={cn(
                      "flex h-(--control-h-sm) cursor-default items-center gap-1 rounded-full border px-2 text-subheadline tabular-nums focus-ring transition-colors duration-(--duration-fast) outline-none enabled:hover:bg-fill disabled:opacity-100",
                      r.mine
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-transparent text-muted-foreground active:bg-fill",
                    )}
                  />
                }
              >
                <span aria-hidden>{EMOJI[r.content]}</span> {r.count}
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

export const ACTIONS =
  "flex items-center opacity-0 transition-opacity duration-(--duration) group-hover/said:opacity-100 group-focus-within/said:opacity-100 has-[[aria-expanded=true]]:opacity-100 motion-reduce:transition-none";

export function CommentMenu({
  url,
  onQuote,
  onEdit,
  onDelete,
}: {
  url: string;
  onQuote?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const t = useT();
  const api = useConversationApi();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t("review.commentActions")}
                />
              }
            />
          }
        >
          <MoreHorizontal />
        </TooltipTrigger>
        <TooltipContent>{t("review.commentActions")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => api?.copyLink(url)}>
          <Copy /> {t("review.copyLink")}
        </DropdownMenuItem>
        {onQuote ? (
          <DropdownMenuItem onClick={onQuote}>
            <Quote /> {t("review.quoteReply")}
          </DropdownMenuItem>
        ) : null}
        {onEdit || onDelete ? <DropdownMenuSeparator /> : null}
        {onEdit ? (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil /> {t("review.edit")}
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> {t("review.delete")}…
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
