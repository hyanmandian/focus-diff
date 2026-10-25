// One pull request in the panel, laid out like Focus Diff's popup: who, the title, then the number
// and what's going on; when and how much talk on the right. A click opens its review window.

import { EllipsisVertical, ExternalLink, EyeOff, GitPullRequest, MessageSquare } from "lucide-react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import type { Queue } from "@/lib/config";
import { ago, EVENTS, firstName, STATUS } from "@/lib/copy";
import type { Actor, Item } from "@/lib/engine";
import { cn } from "@/lib/utils";

const TAG: Record<string, string> = {
  blue: "border-unread/50 text-unread",
  green: "border-success/50 text-success",
  red: "border-destructive/50 text-destructive",
  amber: "border-warning/60 text-warning",
  purple: "border-violet/50 text-violet",
  gray: "border-border text-muted-foreground",
};

function Tag({ tone = "gray", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-4 shrink-0 items-center rounded-full border px-1.5 text-[11px] leading-4", TAG[tone])}>
      {children}
    </span>
  );
}

function Avatar({ actor }: { actor: Actor }) {
  return (
    <span className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[11px] font-bold text-muted-foreground" aria-hidden>
      {(actor?.login ?? "?").charAt(0).toUpperCase()}
      {actor?.avatarUrl ? <img src={actor.avatarUrl} alt="" className="absolute inset-0 size-full" referrerPolicy="no-referrer" /> : null}
    </span>
  );
}

/** "3d", "5h": how long it's been waiting. */
const waited = (ms: number) => (ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)}d` : `${Math.max(1, Math.floor(ms / 3_600_000))}h`);

// What's worth a tag, most direct first.
const ORDER = ["rerequest", "reply", "mention", "changes", "approved", "commits", "ci-failed", "conflict", "comment"] as const;

type Props = {
  item: Item;
  queue: Queue;
  unread: boolean;
  arriving: boolean;
  onOpen: (item: Item) => void;
  onDismiss: (item: Item) => void;
  onArrived: (prId: string) => void;
};

export const PullRow = memo(function PullRow({ item, queue, unread, arriving, onOpen, onDismiss, onArrived }: Props) {
  const { pr } = item;
  const ref = useRef<HTMLDivElement>(null);

  // Something new plays the arrival once, while the panel shows it.
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

  const news = item.events.filter((e) => e.kind !== "new");
  const latest = item.events.reduce<Item["events"][number] | null>((a, e) => (!a || e.at > a.at ? e : a), null);
  const kinds = [...new Set(news.map((e) => e.kind))];
  kinds.sort((a, b) => ORDER.indexOf(a as (typeof ORDER)[number]) - ORDER.indexOf(b as (typeof ORDER)[number]));
  const waiting = item.waitingSince ? Date.now() - item.waitingSince : 0;
  const late = queue.kind === "review" && queue.staleHours > 0 && waiting > queue.staleHours * 3_600_000;
  const mine = queue.kind === "authored";
  const when = queue.kind === "merged" && pr.mergedAt ? Date.parse(pr.mergedAt) : (latest?.at ?? Date.parse(pr.updatedAt));
  const label = [pr.title, `${pr.repository.nameWithOwner} #${pr.number}`, mine ? null : `by ${firstName(pr.author)}`, unread ? "unread" : null, late ? `waiting ${waited(waiting)}` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <div ref={ref} className="group relative isolate rounded-lg">
      <button
        type="button"
        aria-label={label}
        onClick={() => onOpen(item)}
        className={cn(
          "relative flex w-full items-start gap-2.5 rounded-lg py-2 pr-2.5 pl-3.5 text-left outline-none transition-colors hover:bg-foreground/6 focus-visible:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          pr.isDraft && "text-muted-foreground",
        )}
      >
        {unread ? <span data-dot className="absolute top-[15px] left-1 size-1.5 rounded-full bg-unread" aria-hidden /> : null}
        {mine ? (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
            <GitPullRequest className="size-3.5" />
          </span>
        ) : (
          <Avatar actor={pr.author} />
        )}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className={cn("line-clamp-2 text-[13px] leading-[1.35] [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium")}>{pr.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-[18px] text-muted-foreground">
            <span className="flex min-w-0 items-center whitespace-nowrap">
              <span className="shrink-0 tabular-nums">#{pr.number}</span>
              {!mine && pr.author ? <span className="truncate before:mx-1.5 before:content-['·']">{firstName(pr.author)}</span> : null}
              {queue.kind === "merged" && pr.mergedBy ? <span className="truncate before:mx-1.5 before:content-['·']">merged by {firstName(pr.mergedBy)}</span> : null}
            </span>
            {late ? (
              <Tag tone="amber" title={`Waiting on you for ${waited(waiting)}`}>
                {waited(waiting)} waiting
              </Tag>
            ) : null}
            {kinds.slice(0, 2).map((k) => (
              <Tag key={k} tone={EVENTS[k].tone} title={EVENTS[k].long}>
                {EVENTS[k].tag}
              </Tag>
            ))}
            {item.status && item.status !== "MENTIONED" && !kinds.length ? <Tag tone={STATUS[item.status].tone}>{STATUS[item.status].tag}</Tag> : null}
            {item.viaTeams?.length && !kinds.length ? <Tag title="Asked of your team">via {item.viaTeams.map((t) => t.split("/")[1]).join(", ")}</Tag> : null}
            {item.ci === "FAILURE" || item.ci === "ERROR" ? kinds.includes("ci-failed") ? null : <Tag tone="red">CI failed</Tag> : null}
          </span>
        </span>
        <span className="grid shrink-0 justify-items-end gap-1 text-xs leading-[18px] whitespace-nowrap text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible">
          <span>{ago(when)}</span>
          {pr.comments ? (
            <span className="inline-flex items-center gap-1" aria-label={`${pr.comments} comments`}>
              <MessageSquare className="size-3" aria-hidden />
              {pr.comments}
            </span>
          ) : null}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute top-2 right-1.5 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:opacity-100"
          aria-label={`More for ${pr.title}`}
        >
          <EllipsisVertical className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void bridge.openUrl(pr.url)}>
            <ExternalLink /> Open on GitHub
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDismiss(item)}>
            <EyeOff /> {queue.kind === "merged" ? "Mark as seen" : "Ignore"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
