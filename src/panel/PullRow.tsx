// One pull request in the panel, laid out like a row of Focus Diff's popup: who, the title, then one
// secondary line (number, author, estimate, what's going on), with when and how much talk on the
// right. A click opens it.

import { Ellipsis, GitPullRequest, MessageSquare } from "lucide-react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import { prefetch } from "@/lib/prefetch";
import type { Queue } from "@/lib/config";
import { avatar } from "@/lib/avatar";
import { EVENT_TONES, firstName, STATUS_TONES } from "@/lib/copy";
import { pullMinutes, useLearned } from "@/lib/estimate";
import { useT } from "@/lib/i18n";
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
      <span className="px-1.5 text-muted-foreground" aria-hidden>
        ·
      </span>
      {children}
    </span>
  );
}

function Avatar({ actor }: { actor: Actor }) {
  return (
    <span className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground/8 text-footnote font-bold text-muted-foreground" aria-hidden>
      {(actor?.login ?? "?").charAt(0).toUpperCase()}
      {actor?.avatarUrl ? <img src={avatar(actor.avatarUrl)} alt="" width={24} height={24} decoding="async" className="absolute inset-0 size-full" referrerPolicy="no-referrer" /> : null}
    </span>
  );
}

// What's worth a tag, most direct first.
const ORDER = ["rerequest", "reply", "mention", "changes", "approved", "commits", "ci-failed", "conflict", "comment"] as const;

type Props = {
  item: Item;
  queue: Queue;
  unread: boolean;
  arriving: boolean;
  /** `from`: the row, for the review window to grow out of. */
  onOpen: (item: Item, from?: DOMRect) => void;
  onDismiss: (item: Item) => void;
  onArrived: (prId: string) => void;
  /** Picked to be marked done; `selecting`: something in the list is, so every row shows its box. */
  picked: boolean;
  selecting: boolean;
  onPick: (item: Item, on: boolean) => void;
};

export const PullRow = memo(function PullRow({ item, queue, unread, arriving, onOpen, onDismiss, onArrived, picked, selecting, onPick }: Props) {
  const { pr } = item;
  const t = useT();
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
  const status = item.status && item.status !== "MENTIONED" && !kinds.length ? item.status : null;
  // "3d", "5h": how long it's been waiting, an hour at least.
  const waited = t.since(Date.now() - Math.max(waiting, 3_600_000));
  // How long a review would take, for what's waiting on yours: from its totals, at your pace.
  const learned = useLearned();
  const minutes = queue.kind === "review" && pr.changedFiles ? pullMinutes(pr, learned) : null;

  return (
    // As Focus Diff's popup: over the picture, a box to pick the row to mark done, on hover, on the
    // focused row, and on every row once one is picked; a picked row takes a tint of the accent.
    <div ref={ref} data-picked={picked || undefined} data-selecting={selecting || undefined} className="group relative isolate rounded-[8px]">
      <input
        type="checkbox"
        tabIndex={-1}
        checked={picked}
        onChange={(e) => onPick(item, e.target.checked)}
        aria-label={t("panel.select", { title: pr.title })}
        className="absolute top-3 left-[18px] z-10 m-0 size-4 cursor-default accent-(--primary) opacity-0 group-hover:opacity-100 group-has-[[data-row]:focus-visible]:opacity-100 group-data-picked:opacity-100 group-data-selecting:opacity-100"
      />
      <button
        type="button"
        data-row
        aria-keyshortcuts="x"
        onClick={(e) => onOpen(item, e.currentTarget.getBoundingClientRect())}
        onPointerEnter={() => (intent.current = setTimeout(ahead, 120))}
        onPointerLeave={() => clearTimeout(intent.current)}
        onFocus={ahead}
        className={cn(
          // The extension's row: the picture on a 14pt inset, a quiet rounded highlight under the
          // pointer and on the keyboard's row (a ring would fight the tint of a picked one).
          "relative flex w-full cursor-default items-start gap-2.5 rounded-[8px] py-2 pr-2.5 pl-3.5 text-left outline-none transition-colors duration-100 hover:bg-foreground/6 active:bg-foreground/9 focus-visible:bg-foreground/8 group-data-picked:bg-primary/15",
        )}
      >
        {/* What changed since you last looked: a dot at the row's edge, level with the title. */}
        {unread ? <span data-dot className="absolute top-4 left-1 size-1.5 rounded-full bg-primary" aria-hidden /> : null}
        {unread ? <span className="sr-only">{t("panel.unread")}</span> : null}
        {/* The picture gives way to the box over it. */}
        <span className="contents group-hover:[&>*]:invisible group-has-[[data-row]:focus-visible]:[&>*]:invisible group-data-picked:[&>*]:invisible group-data-selecting:[&>*]:invisible">
          {mine ? (
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground/8 text-muted-foreground" aria-hidden>
              <GitPullRequest className="size-3.5" />
            </span>
          ) : (
            <Avatar actor={pr.author} />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("line-clamp-2 text-body leading-[1.35] [overflow-wrap:anywhere]", unread ? "font-semibold" : "font-medium", pr.isDraft && "text-muted-foreground")}>{pr.title}</span>
          {/* One line: the number and who never give way; what doesn't fit after them drops off whole,
              onto a hidden second line, rather than ending in "…". The full list is its tooltip. */}
          <span
            className="flex h-[18px] min-w-0 flex-wrap items-center overflow-hidden text-callout leading-[18px] text-muted-foreground"
            title={teams.length ? t("panel.askedOf", { teams: t.list(teams) }) : undefined}
          >
            <span className="shrink-0 tabular-nums">#{pr.number}</span>
            {!mine && pr.author ? (
              <Part className="max-w-[16ch]">
                <span className="truncate">{pr.author.login}</span>
              </Part>
            ) : null}
            {minutes !== null ? (
              <Part className="text-foreground tabular-nums" title={t("panel.aboutToReview", { time: t.duration(minutes).replace(/^~/, "") })}>
                {t.duration(minutes)}
              </Part>
            ) : null}
            {queue.kind === "merged" && pr.mergedBy ? <Part>{t("panel.mergedBy", { name: firstName(pr.mergedBy, t) })}</Part> : null}
            {late ? (
              <Part tone="amber" title={t("panel.waitingTip", { time: waited })}>
                {t("panel.waiting", { time: waited })}
              </Part>
            ) : null}
            {kinds.slice(0, 2).map((k) => (
              <Part key={k} tone={EVENT_TONES[k]} title={t(`events.long.${k}`)}>
                {t(`events.tag.${k}`)}
              </Part>
            ))}
            {status ? (
              <Part tone={STATUS_TONES[status]} title={t(`events.statusLong.${status}`)}>
                {t(`events.status.${status}`)}
              </Part>
            ) : null}
            {ci ? <Part tone="red">{t("panel.ciFailed")}</Part> : null}
            {teams.length ? (
              <Part className="max-w-[24ch]">
                <span className="truncate">
                  {t("panel.via", { team: teams[0]!.split("/")[1]! })}
                  {teams.length > 1 ? ` +${teams.length - 1}` : ""}
                </span>
              </Part>
            ) : null}
          </span>
        </span>
        {/* When and how much talk, on the right: the time level with the title, the comments under it
            (under the pointer, the row's menu takes their place). */}
        <span className="flex min-w-10 shrink-0 flex-col items-end gap-1 text-callout leading-[18px] whitespace-nowrap text-muted-foreground tabular-nums">
          <span>{t.since(when)}</span>
          {pr.comments ? (
            <span className="inline-flex items-center gap-1 group-focus-within:invisible group-hover:invisible" aria-label={t("common.comments", { count: pr.comments })}>
              <MessageSquare className="size-3.5" aria-hidden />
              {pr.comments}
            </span>
          ) : null}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute right-2 bottom-1.5 grid size-6 cursor-default place-items-center rounded-[6px] text-muted-foreground opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-ring hover:bg-foreground/8 data-[popup-open]:bg-foreground/8 data-[popup-open]:opacity-100"
          aria-label={t("panel.more", { title: pr.title })}
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void bridge.openUrl(pr.url)}>{t("panel.openOnGitHub")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDismiss(item)}>{queue.kind === "merged" ? t("panel.markSeen") : t("panel.ignore")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
