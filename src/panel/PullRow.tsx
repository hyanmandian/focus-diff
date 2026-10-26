// One pull request in the panel, laid out like a Mail row: who, the title with when it last moved,
// then one secondary line (number, author, what's going on) with how much talk. A click opens it.

import { Ellipsis, ExternalLink, EyeOff, GitPullRequest, MessageSquare } from "lucide-react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import { prefetch } from "@/lib/prefetch";
import type { Queue } from "@/lib/config";
import { avatar } from "@/lib/avatar";
import { ago, EVENTS, firstName, STATUS } from "@/lib/copy";
import { formatDuration, pullMinutes, useLearned } from "@/lib/estimate";
import type { Actor, Item } from "@/lib/engine";
import { cn } from "@/lib/utils";

// What each note is, said in color on plain text (no outline): a list row's secondary line, not a pill.
const TONE: Record<string, string> = {
  blue: "text-(--panel-link)",
  green: "text-success",
  red: "text-destructive",
  amber: "text-warning",
  purple: "text-violet",
  gray: "",
};

/** One part of the secondary line. Parts never cut mid-word: what doesn't fit drops off whole. */
function Part({ tone = "gray", title, className, children }: { tone?: string; title?: string; className?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn("flex min-w-0 shrink-0 items-center whitespace-nowrap", TONE[tone], className)}>
      <span className="px-1 text-muted-foreground" aria-hidden>
        ·
      </span>
      {children}
    </span>
  );
}

function Avatar({ actor }: { actor: Actor }) {
  return (
    <span className="relative mt-[-1px] grid size-5 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground/8 text-[10px] font-semibold text-muted-foreground" aria-hidden>
      {(actor?.login ?? "?").charAt(0).toUpperCase()}
      {actor?.avatarUrl ? <img src={avatar(actor.avatarUrl)} alt="" width={20} height={20} decoding="async" className="absolute inset-0 size-full" referrerPolicy="no-referrer" /> : null}
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
  const intent = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Resting on a row, not passing over it: then its pull request is fetched ahead of a click.
  const ahead = () => void prefetch(pr.id, pr.repository.nameWithOwner, pr.number, pr.updatedAt);

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

  const teams = item.viaTeams?.length && !kinds.length ? item.viaTeams : [];
  const ci = (item.ci === "FAILURE" || item.ci === "ERROR") && !kinds.includes("ci-failed");
  const status = item.status && item.status !== "MENTIONED" && !kinds.length ? STATUS[item.status] : null;
  // How long a review would take, for what's waiting on yours: from its totals, at your pace.
  const learned = useLearned();
  const minutes = queue.kind === "review" && pr.changedFiles ? pullMinutes(pr, learned) : null;

  return (
    <div ref={ref} className="group relative isolate rounded-[6px]">
      <button
        type="button"
        data-row
        onClick={() => onOpen(item)}
        onPointerEnter={() => (intent.current = setTimeout(ahead, 120))}
        onPointerLeave={() => clearTimeout(intent.current)}
        onFocus={ahead}
        className={cn(
          // A native list row: the content on the panel's 16pt inset (4pt list gutter + 12pt), a quiet
          // rounded highlight on hover, deeper when pressed, the accent ring for the keyboard.
          "relative flex w-full items-start gap-2.5 rounded-[6px] py-2 pr-3 pl-3 text-left outline-none transition-colors duration-150 hover:bg-foreground/5 active:bg-foreground/9 focus-visible:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          pr.isDraft && "text-muted-foreground",
        )}
      >
        {/* The dot sits in the leading gutter, centred on the title's first line (8 + 9 - 3). */}
        {unread ? <span data-dot className="absolute top-[14px] left-[3px] size-1.5 rounded-full bg-unread" aria-hidden /> : null}
        {/* Its name is what it shows; what only shows as a dot is said too. */}
        {unread ? <span className="sr-only">Unread: </span> : null}
        {/* 20pt, centred on the title's first line. */}
        {mine ? (
          <span className="mt-[-1px] grid size-5 shrink-0 place-items-center rounded-full bg-foreground/8 text-muted-foreground" aria-hidden>
            <GitPullRequest className="size-3" />
          </span>
        ) : (
          <Avatar actor={pr.author} />
        )}
        {/* Two lines on one grid: title | when, then the secondary line | comments. */}
        <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5">
          <span className="line-clamp-2 text-[13px] leading-[18px] font-semibold [overflow-wrap:anywhere]">{pr.title}</span>
          <span className="text-[12px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums group-focus-within:invisible group-hover:invisible">{ago(when)}</span>
          {/* One line: the number and who never give way; what doesn't fit after them drops off whole,
              onto a hidden second line, rather than ending in "…". The full list is its tooltip. */}
          <span
            className="flex h-4 min-w-0 flex-wrap items-center overflow-hidden text-[12px] leading-4 text-muted-foreground"
            title={teams.length ? `Asked of ${teams.join(", ")}` : undefined}
          >
            <span className="shrink-0 tabular-nums">#{pr.number}</span>
            {!mine && pr.author ? (
              <Part className="max-w-[14ch]">
                <span className="truncate">{firstName(pr.author)}</span>
              </Part>
            ) : null}
            {queue.kind === "merged" && pr.mergedBy ? <Part>merged by {firstName(pr.mergedBy)}</Part> : null}
            {late ? (
              <Part tone="amber" title={`Waiting on you for ${waited(waiting)}`}>
                waiting {waited(waiting)}
              </Part>
            ) : null}
            {kinds.slice(0, 2).map((k) => (
              <Part key={k} tone={EVENTS[k].tone} title={EVENTS[k].long}>
                {EVENTS[k].tag}
              </Part>
            ))}
            {status ? (
              <Part tone={status.tone} title={status.long}>
                {status.tag}
              </Part>
            ) : null}
            {ci ? <Part tone="red">CI failed</Part> : null}
            {minutes !== null ? <Part title={`About ${formatDuration(minutes).replace(/^~/, "")} to review, at your pace`}>{formatDuration(minutes)}</Part> : null}
            {teams.length ? (
              <Part className="max-w-[24ch]">
                <span className="truncate">
                  via {teams[0]!.split("/")[1]}
                  {teams.length > 1 ? ` +${teams.length - 1}` : ""}
                </span>
              </Part>
            ) : null}
          </span>
          {pr.comments ? (
            <span className="inline-flex items-center justify-self-end gap-1 text-[12px] leading-4 text-muted-foreground tabular-nums" aria-label={`${pr.comments} comments`}>
              <MessageSquare className="size-3 translate-y-px" aria-hidden />
              {pr.comments}
            </span>
          ) : (
            <span />
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute top-[3px] right-1.5 grid size-7 place-items-center rounded-[6px] text-muted-foreground opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:opacity-100"
          aria-label={`More for ${pr.title}`}
        >
          <Ellipsis className="size-4" />
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
