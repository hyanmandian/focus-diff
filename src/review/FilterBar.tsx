// Focus Diff's bar, floating over the diff: the next file to review, the filters as chips (several
// on at once; none is All), the lines in view with the time left to review them, and a breakdown of
// what each filter holds.

import { Check, ChartBarStacked, ChevronsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { inFilter, type DiffFilter } from "@/lib/config";
import { ESTIMATE_HINT, formatDuration, type Estimator, type Learned } from "@/lib/estimate";
import { totals, type Totals } from "@/lib/filters";
import type { ReviewFile } from "@/lib/review";
import { cn } from "@/lib/utils";

const isMac = navigator.userAgent.includes("Mac");
/** A shortcut as the platform writes it: ⌥⇧J, or Alt+Shift+J. */
export const chord = (key: string) => (isMac ? `⌥⇧${key}` : `Alt+Shift+${key}`);

/** What's left to review: files in the chosen filters, or else the next filter that has some. */
export type Next = { left: number; nextFilter?: { id: string; name: string; left: number } };

type Props = {
  files: ReviewFile[];
  /** The filters this repository gets, in order. */
  filters: DiffFilter[];
  chosen: string[];
  /** What the chosen filters hold. */
  shown: Totals;
  next: Next;
  isViewed: (f: ReviewFile) => boolean;
  minutesOf: Estimator;
  learned: Learned | null;
  onToggle: (id: string) => void;
  onNextFile: () => void;
};

const nextLabel = ({ left, nextFilter }: Next) =>
  left
    ? `Next file to review, ${left} left`
    : nextFilter
      ? `Next: ${nextFilter.name}, ${nextFilter.left} ${nextFilter.left === 1 ? "file" : "files"} to review`
      : "Every file here is viewed";

const timeHint = (learned: Learned | null) => {
  const files = Math.round(learned?.all.files ?? 0);
  return files ? `${ESTIMATE_HINT} It follows your own pace, learned from ${files} ${files === 1 ? "file" : "files"} you marked as viewed.` : ESTIMATE_HINT;
};

/** A five-square diffstat, as GitHub draws one: the share of added and removed lines. */
function Diffstat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total ? Math.round((additions / total) * 5) : 0;
  const removed = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0;
  return (
    <span className="flex gap-px" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("size-[7px] rounded-[1.5px]", i < added ? "bg-success" : i < added + removed ? "bg-destructive" : "bg-muted-foreground/25")} />
      ))}
    </span>
  );
}

/** How the pull request splits across the filters: files viewed, lines and time left for each.
 *  Rows turn their filter on and off, like the chips. */
function Breakdown({ files, filters, chosen, isViewed, minutesOf, learned, onToggle }: Pick<Props, "files" | "filters" | "chosen" | "isViewed" | "minutesOf" | "learned" | "onToggle">) {
  const rows = [{ id: "", name: "All", t: totals(files, isViewed, minutesOf) }, ...filters.map((f) => ({ id: f.id, name: f.name, t: totals(files.filter((x) => inFilter(f, x.path)), isViewed, minutesOf) }))];
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-xs font-semibold">Breakdown by filter</p>
      <div role="group" aria-label="Filters" className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 text-xs">
        <div aria-hidden className="col-span-full grid grid-cols-subgrid px-2 pb-1 text-[11px] text-muted-foreground">
          <span />
          <span>Filter</span>
          <span className="text-right">Viewed</span>
          <span>Lines</span>
          <span className="text-right">Time left</span>
        </div>
        {rows.map(({ id, name, t }) => {
          const selected = id ? chosen.includes(id) : !chosen.length;
          const complete = t.files > 0 && t.viewed === t.files;
          // A filter with nothing in this pull request can't be turned on.
          const empty = t.files === 0 && !selected;
          const left = t.minutesLeft === 0 ? "" : formatDuration(t.minutesLeft);
          return (
            <button
              key={id || "all"}
              type="button"
              aria-pressed={selected}
              aria-disabled={empty}
              title={empty ? `No files in ${name}` : undefined}
              aria-label={`${name}: ${t.files} ${t.files === 1 ? "file" : "files"}, ${t.viewed} viewed, ${t.additions} lines added, ${t.deletions} removed. ${t.minutesLeft === 0 ? "Done" : `${left} left to review`}`}
              onClick={() => !empty && onToggle(id)}
              className={cn(
                "col-span-full grid h-7 grid-cols-subgrid items-center rounded-md px-2 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
                empty && "text-muted-foreground hover:bg-transparent",
              )}
            >
              <span aria-hidden>{selected ? <Check className="size-3.5" /> : null}</span>
              <span className="truncate font-medium">{name}</span>
              <span className={cn("text-right tabular-nums", complete ? "text-success" : "text-muted-foreground")}>
                {t.viewed}/{t.files}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                <span className="text-success">+{t.additions}</span>
                <span className="text-destructive">−{t.deletions}</span>
                <Diffstat additions={t.additions} deletions={t.deletions} />
              </span>
              <span className="text-right text-muted-foreground tabular-nums">{left}</span>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-[11px] leading-snug text-muted-foreground">{timeHint(learned)}</p>
    </div>
  );
}

export function FilterBar(props: Props) {
  const { files, filters, chosen, shown, next, learned, onToggle, onNextFile } = props;
  const counts = new Map(filters.map((f) => [f.id, files.filter((x) => inFilter(f, x.path)).length]));
  const done = shown.files > 0 && shown.minutesLeft === 0;
  const label = nextLabel(next);
  const stuck = !next.left && !next.nextFilter;
  const chip = (id: string, name: string, count: number) => {
    const pressed = id ? chosen.includes(id) : !chosen.length;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={pressed}
        aria-keyshortcuts={id ? undefined : "Alt+Shift+0"}
        title={id ? undefined : `Show all files (${chord("0")})`}
        onClick={() => onToggle(id)}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-lg pr-1.5 pl-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          pressed ? "bg-selected text-selected-foreground" : "hover:bg-foreground/6",
          count === 0 && !pressed && "text-muted-foreground",
        )}
      >
        {name}
        <span className={cn("rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums", pressed ? "bg-black/16" : "bg-muted text-muted-foreground")}>{count}</span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Review one part"
      aria-keyshortcuts={filters.length ? "Alt+Shift+. Alt+Shift+," : undefined}
      className="absolute inset-x-4 bottom-4 isolate z-20 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-xl border bg-popover/95 p-1 shadow-xl backdrop-blur [scrollbar-width:none]"
    >
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" className="shrink-0 rounded-lg" aria-label={label} aria-disabled={stuck} aria-keyshortcuts="Alt+Shift+J" onClick={() => !stuck && onNextFile()} />}
        >
          <ChevronsDown className={cn(stuck && "opacity-50")} />
        </TooltipTrigger>
        <TooltipContent>
          {label} {stuck ? null : <kbd className="ml-1 font-mono">{chord("J")}</kbd>}
        </TooltipContent>
      </Tooltip>
      {filters.length ? (
        <>
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
          {chip("", "All", files.length)}
          {filters.map((f) => chip(f.id, f.name, counts.get(f.id) ?? 0))}
        </>
      ) : null}
      <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
      <span className="shrink-0 font-mono text-[11px] whitespace-nowrap tabular-nums" aria-label={`Lines in view: ${shown.additions} added, ${shown.deletions} removed`}>
        <span className="text-success">+{shown.additions}</span> <span className="text-destructive">−{shown.deletions}</span>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="shrink-0 rounded-md px-1.5 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={done ? "Done: every file here is viewed" : `About ${formatDuration(shown.minutesLeft).replace(/^~/, "")} left to review`}
            />
          }
        >
          {done ? (
            <span className="flex items-center gap-1 text-success">
              <Check className="size-3" aria-hidden /> Done
            </span>
          ) : (
            `${formatDuration(shown.minutesLeft)} left`
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{timeHint(learned)}</TooltipContent>
      </Tooltip>
      {filters.length ? (
        <Popover>
          <Tooltip>
            <TooltipTrigger render={<PopoverTrigger render={<Button variant="ghost" size="icon-sm" className="shrink-0 rounded-lg" aria-label="Breakdown by filter" />} />}>
              <ChartBarStacked />
            </TooltipTrigger>
            <TooltipContent>Breakdown by filter</TooltipContent>
          </Tooltip>
          <PopoverContent side="top" align="end" className="w-auto min-w-80 max-w-[min(32rem,calc(100vw-2rem))]">
            <Breakdown {...props} />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
