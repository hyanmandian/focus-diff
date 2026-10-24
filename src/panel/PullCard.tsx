// One pull request in a queue: who and when, the title, what happened, and its state at a glance.
// Unclicked cards are tinted; a card with something new plays the arrival animation once the panel
// is open.

import { CircleCheck, CircleDot, CircleX, EllipsisVertical, ExternalLink, EyeOff, GitMerge } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bridge } from "@/lib/bridge";
import type { Queue } from "@/lib/config";
import { ago, EVENTS, firstName, STATUS } from "@/lib/copy";
import { isBot, requests, type Actor, type CiState, type Item } from "@/lib/engine";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  blue: "bg-unread/14 text-unread",
  purple: "bg-violet/14 text-violet",
  green: "bg-success/14 text-success",
  amber: "bg-warning/16 text-warning",
  red: "bg-destructive/14 text-destructive",
  gray: "bg-muted text-muted-foreground",
};

function Tag({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  const tag = <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap", TONE[tone])}>{children}</span>;
  if (!title) return tag;
  return (
    <Tooltip>
      <TooltipTrigger render={tag} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function Person({ actor, className }: { actor: Actor; className?: string }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {actor?.avatarUrl ? <AvatarImage src={actor.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-[9px]">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

const CI: Record<CiState, { icon: typeof CircleCheck; className: string; label: string }> = {
  SUCCESS: { icon: CircleCheck, className: "text-success", label: "CI passed" },
  FAILURE: { icon: CircleX, className: "text-destructive", label: "CI failed" },
  ERROR: { icon: CircleX, className: "text-destructive", label: "CI failed" },
  PENDING: { icon: CircleDot, className: "text-warning animate-pulse motion-reduce:animate-none", label: "CI running" },
  EXPECTED: { icon: CircleDot, className: "text-warning", label: "CI waiting" },
};

type Props = {
  item: Item;
  queue: Queue;
  me: string;
  unread: boolean;
  arriving: boolean;
  onOpen: (item: Item) => void;
  onDismiss: (item: Item) => void;
  onArrived: (prId: string) => void;
};

export const PullCard = memo(function PullCard({ item, queue, me, unread, arriving, onOpen, onDismiss, onArrived }: Props) {
  const { pr } = item;
  const ref = useRef<HTMLDivElement>(null);
  const latest = item.events.reduce<Item["events"][number] | null>((a, e) => (!a || e.at > a.at ? e : a), null);
  const news = item.events.filter((e) => e.kind !== "new");
  const lastNews = news.reduce<Item["events"][number] | null>((a, e) => (!a || e.at > a.at ? e : a), null);

  // Play the arrival once; it's cleared when it ends.
  useEffect(() => {
    const el = ref.current;
    if (!arriving || !el) return;
    el.classList.remove("arrive");
    void el.offsetWidth;
    el.classList.add("arrive");
    const done = () => {
      el.classList.remove("arrive");
      onArrived(pr.id);
    };
    el.addEventListener("animationend", done, { once: true });
    return () => el.removeEventListener("animationend", done);
  }, [arriving, onArrived, pr.id]);

  const repo = pr.repository.nameWithOwner.split("/")[1];
  const when = queue.kind === "merged" ? pr.mergedAt : null;
  const subject = queue.kind === "authored" && lastNews?.who ? lastNews.who : pr.author;
  const note =
    queue.kind === "merged"
      ? `Merged${pr.mergedBy ? ` by ${firstName(pr.mergedBy)}` : ""}`
      : lastNews
        ? EVENTS[lastNews.kind].say(firstName(lastNews.who))
        : queue.kind === "authored"
          ? "Waiting for reviews"
          : null;

  // Tags: how you left it, the most direct news, then state.
  const kinds = new Map<string, number>();
  for (const e of news) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  if (item.status === "MENTIONED") kinds.delete("mention");
  const order = ["rerequest", "reply", "mention", "changes", "approved", "commits", "ci-failed", "conflict", "comment"];
  const ranked = [...kinds].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const reviewers =
    queue.kind === "authored"
      ? [
          ...pr.latestOpinionatedReviews.nodes.filter((r) => !isBot(r.author) && r.author?.login !== me).map((r) => ({ actor: r.author, state: r.state })),
          ...requests(pr, me)
            .users.filter((u) => !pr.latestOpinionatedReviews.nodes.some((r) => r.author?.login === u.login))
            .map((u) => ({ actor: { login: u.login, avatarUrl: u.avatarUrl } as Actor, state: "PENDING" })),
        ]
      : [];
  const ci = item.ci ? CI[item.ci] : null;
  const label = `${pr.title}, ${repo} #${pr.number} by ${firstName(pr.author)}${unread ? ", unread" : ""}${note ? `. ${note}` : ""}`;

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item);
        }
      }}
      className={cn(
        "group relative isolate flex cursor-pointer flex-col gap-1.5 rounded-xl px-3 py-2.5 outline-none transition-colors",
        "hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
        unread && "bg-unread/8 hover:bg-unread/13",
      )}
    >
      <div className="flex items-center gap-2 pr-6 text-xs text-muted-foreground">
        <Person actor={subject} />
        <span className="truncate">
          <span className="font-medium text-foreground/80">{firstName(subject)}</span>
          {" · "}
          {repo} #{pr.number}
          {" · "}
          {ago(when ? Date.parse(when) : (latest?.at ?? Date.parse(pr.updatedAt)))}
        </span>
        {ci ? (
          <Tooltip>
            <TooltipTrigger render={<span className="ml-auto flex shrink-0" />}>
              <ci.icon className={cn("size-3.5", ci.className)} aria-label={ci.label} />
            </TooltipTrigger>
            <TooltipContent>{ci.label}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <p className={cn("line-clamp-2 text-[13px] leading-snug text-foreground", unread ? "font-semibold" : "font-medium")}>{pr.title}</p>
      {note ? <p className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>{note}</p> : null}
      <div className="flex flex-wrap items-center gap-1 empty:hidden">
        {item.status ? <Tag tone={STATUS[item.status].tone} title={STATUS[item.status].long}>{STATUS[item.status].tag}</Tag> : null}
        {item.viaTeams?.length ? <Tag tone="gray" title="Requested from your team">via {item.viaTeams.map((t) => t.split("/")[1]).join(", ")}</Tag> : null}
        {ranked.slice(0, 2).map(([kind, n]) => {
          const copy = EVENTS[kind as keyof typeof EVENTS];
          return (
            <Tag key={kind} tone={copy.tone} title={copy.long}>
              {n > 1 && copy.many ? `${n} ${copy.many}` : copy.tag}
            </Tag>
          );
        })}
        {ranked.length > 2 ? <Tag tone="gray" title={ranked.slice(2).map(([k]) => EVENTS[k as keyof typeof EVENTS].long).join("\n")}>+{ranked.length - 2}</Tag> : null}
        {pr.isDraft ? <Tag tone="gray">Draft</Tag> : null}
        {queue.kind === "merged" ? <GitMerge className="size-3.5 text-violet" aria-label="Merged" /> : null}
        {reviewers.length ? (
          <span className="ml-0.5 flex -space-x-1">
            {reviewers.slice(0, 5).map(({ actor, state }) => (
              <Tooltip key={actor?.login}>
                <TooltipTrigger
                  render={
                    <span
                      className={cn(
                        "rounded-full ring-2 ring-background",
                        state === "APPROVED" && "outline-2 outline-success",
                        state === "CHANGES_REQUESTED" && "outline-2 outline-destructive",
                        state === "PENDING" && "opacity-50",
                      )}
                    />
                  }
                >
                  <Person actor={actor} className="size-4" />
                </TooltipTrigger>
                <TooltipContent>
                  {firstName(actor)}: {state === "APPROVED" ? "approved" : state === "CHANGES_REQUESTED" ? "requested changes" : "hasn't reviewed yet"}
                </TooltipContent>
              </Tooltip>
            ))}
          </span>
        ) : null}
      </div>

      {unread ? <span data-dot aria-hidden className="absolute top-3.5 right-3 size-2 rounded-full bg-unread" /> : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More for ${pr.title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-visible:opacity-100 hover:bg-foreground/10 hover:text-foreground data-[popup-open]:opacity-100",
            unread && "right-6",
          )}
        >
          <EllipsisVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => onOpen(item)}>Open</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void bridge.openUrl(pr.url)}>
            <ExternalLink /> Open on GitHub
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDismiss(item)}>
            <EyeOff /> {queue.kind === "merged" ? "Mark as seen" : "Hide from this queue"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
