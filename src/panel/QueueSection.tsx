// A queue in the panel: its name and count, then its cards (unclicked first, then newest). It can
// be folded away; that choice is remembered on this machine.

import { CheckCheck, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Queue } from "@/lib/config";
import type { Item } from "@/lib/engine";
import { cn } from "@/lib/utils";
import { PullCard } from "./PullCard";

const DOT: Record<Queue["tone"], string> = {
  blue: "bg-unread",
  purple: "bg-violet",
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  gray: "bg-muted-foreground",
};

const EMPTY: Record<Queue["kind"], string> = {
  review: "Nothing waiting on your review.",
  involved: "Nothing new where you took part.",
  authored: "You have no open pull requests.",
  merged: "Nothing merged without you lately.",
  custom: "Nothing matches this search.",
};

const foldKey = (id: string) => `folded:${id}`;
const readFolded = (id: string) => {
  try {
    return localStorage.getItem(foldKey(id)) === "1";
  } catch {
    return false;
  }
};

type Props = {
  queue: Queue;
  items: Item[];
  me: string;
  isUnread: (item: Item) => boolean;
  arrivals: Set<string>;
  onOpen: (item: Item) => void;
  onDismiss: (item: Item) => void;
  onArrived: (prId: string) => void;
  onMarkSeen: (queueId: string) => void;
};

export function QueueSection({ queue, items, me, isUnread, arrivals, onOpen, onDismiss, onArrived, onMarkSeen }: Props) {
  const [open, setOpen] = useState(() => !readFolded(queue.id));
  const sorted = [...items].sort((a, b) => {
    const ua = isUnread(a) ? 1 : 0;
    const ub = isUnread(b) ? 1 : 0;
    const at = (i: Item) => Math.max(...i.events.map((e) => e.at), Date.parse(i.pr.updatedAt));
    return ub - ua || at(b) - at(a);
  });
  const unread = sorted.filter(isUnread).length;
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(foldKey(queue.id), next ? "0" : "1");
    } catch {
      // Folding still works for this session.
    }
  };

  return (
    <Collapsible open={open} onOpenChange={toggle} render={<section aria-labelledby={`queue-${queue.id}`} />}>
      <div className="sticky top-0 z-10 flex h-9 items-center gap-1 bg-background/85 px-2 backdrop-blur-md">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} aria-hidden />
          <span className={cn("size-2 shrink-0 rounded-full", DOT[queue.tone])} aria-hidden />
          <h2 id={`queue-${queue.id}`} className="truncate text-[13px] font-semibold">
            {queue.name}
          </h2>
          <span
            className={cn(
              "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums",
              unread ? "bg-unread text-white dark:text-background" : "bg-muted text-muted-foreground",
            )}
            aria-label={`${sorted.length} pull requests${unread ? `, ${unread} unread` : ""}`}
          >
            {sorted.length}
          </span>
        </CollapsibleTrigger>
        {unread ? (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Mark ${queue.name} as read`} onClick={() => onMarkSeen(queue.id)} />}>
              <CheckCheck />
            </TooltipTrigger>
            <TooltipContent>Mark all as read</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <CollapsibleContent className="px-1.5 pb-2">
        {sorted.length ? (
          <ul className="flex flex-col gap-0.5">
            {sorted.map((item) => (
              <li key={item.pr.id}>
                <PullCard
                  item={item}
                  queue={queue}
                  me={me}
                  unread={isUnread(item)}
                  arriving={arrivals.has(item.pr.id)}
                  onOpen={onOpen}
                  onDismiss={onDismiss}
                  onArrived={onArrived}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">{EMPTY[queue.kind]}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
