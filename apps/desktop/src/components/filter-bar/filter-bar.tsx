// Focus Diff's bar, floating over the diff: the next file to review, the filters as chips (several
// on at once; none is All), the lines in view with the time left to review them, and a breakdown of
// what each filter holds.

import type { Estimator, Learned } from "@focus-diff/core/estimate";
import { inFilter } from "@focus-diff/core/filters";
import { ChartBarStacked, Check, ChevronsDown, CircleCheck, Clock, FileText, Info } from "lucide-react";

import { Button } from "@/components/button/button";
import { Kbd } from "@/components/kbd/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { cn } from "@/utils/cn/cn";
import type { DiffFilter } from "@/utils/config/config";
import { estimateHint } from "@/utils/estimate/estimate";
import { totals, type Totals } from "@/utils/filters/filters";
import { useT, type T } from "@/utils/i18n/i18n";
import { shortcut } from "@/utils/platform/platform";
import type { ReviewFile } from "@/utils/review/review";

/** A filter shortcut as the platform writes it: ⌥⇧J, or Alt+Shift+J. */
export const chord = (key: string) => shortcut(key, ["alt", "shift"]);

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

const nextLabel = ({ left, nextFilter }: Next, t: T) =>
  left
    ? t("review.nextFile", { count: left })
    : nextFilter
      ? t("review.nextFilter", { filter: nextFilter.name, count: nextFilter.left })
      : t("review.allViewed");

const timeHint = (learned: Learned | null, t: T) => {
  const files = Math.round(learned?.all.files ?? 0);
  return files ? t("review.paceHint", { hint: estimateHint(t), count: files }) : estimateHint(t);
};

/** A five-square diffstat, as GitHub draws one: the share of added and removed lines. */
function Diffstat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total ? Math.round((additions / total) * 5) : 0;
  const removed = total ? Math.min(5 - added, Math.round((deletions / total) * 5)) : 0;
  return (
    <span className="flex gap-px" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn(
            "size-2 rounded-[1px]",
            i < added ? "bg-success" : i < added + removed ? "bg-destructive" : "bg-foreground/15",
          )}
        />
      ))}
    </span>
  );
}

/** How the pull request splits across the filters: files viewed, lines and time left for each.
 *  Rows turn their filter on and off, like the chips. */
function Breakdown({
  files,
  filters,
  chosen,
  isViewed,
  minutesOf,
  learned,
  onToggle,
}: Pick<Props, "files" | "filters" | "chosen" | "isViewed" | "minutesOf" | "learned" | "onToggle">) {
  const t = useT();
  const rows = [
    { id: "", name: t("review.all"), sums: totals(files, isViewed, minutesOf) },
    ...filters.map((f) => ({
      id: f.id,
      name: f.name,
      sums: totals(
        files.filter((x) => inFilter(f, x.path)),
        isViewed,
        minutesOf,
      ),
    })),
  ];
  // As the extension's: no title (the button says what it is), the columns over hairline-split rows,
  // the time column explained by the (i) beside it.
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of rows (subgrid), which a <fieldset> doesn't lay out reliably in WebKit.
      role="group"
      aria-label={t("review.filters")}
      className="grid max-h-[min(52vh,420px)] grid-cols-[16px_minmax(96px,max-content)_repeat(3,max-content)] gap-x-4 overflow-y-auto overscroll-contain p-2 text-body tabular-nums"
    >
      <div className="col-span-full grid grid-cols-subgrid items-center border-b border-border/60 px-2 pb-1.5 text-callout leading-4 text-muted-foreground">
        <span />
        <span>{t("review.columnFilter")}</span>
        <span className="-ml-1.5">{t("review.columnViewed")}</span>
        <span className="ml-5 justify-self-end">{t("review.columnLines")}</span>
        <span className="inline-flex items-center gap-0.5 justify-self-end">
          {t("review.columnTime")}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="grid size-5 cursor-default place-items-center rounded-full text-muted-foreground focus-ring outline-none hover:text-foreground"
                  aria-label={t("review.columnTime")}
                  // oxlint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is global in ARIA 1.3 (WebKit reads it); the rule's list is older.
                  aria-description={timeHint(learned, t)}
                />
              }
            >
              <Info className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent className="max-w-72">{timeHint(learned, t)}</TooltipContent>
          </Tooltip>
        </span>
      </div>
      {rows.map(({ id, name, sums }, i) => {
        const selected = id ? chosen.includes(id) : chosen.length === 0;
        const complete = sums.files > 0 && sums.viewed === sums.files;
        // A filter with nothing in this pull request can't be turned on.
        const empty = sums.files === 0 && !selected;
        const left = sums.minutesLeft === 0 ? "" : t.duration(sums.minutesLeft);
        return (
          <button
            key={id || "all"}
            type="button"
            aria-pressed={selected}
            aria-disabled={empty}
            title={empty ? t("review.noFilesInFilter", { name }) : undefined}
            aria-label={t("review.breakdownRow", {
              name,
              files: t("common.files", { count: sums.files }),
              viewed: sums.viewed,
              additions: sums.additions,
              deletions: sums.deletions,
              left: sums.minutesLeft === 0 ? t("review.done") : t("review.leftToReview", { time: left }),
            })}
            onClick={() => {
              if (!empty) onToggle(id);
            }}
            className={cn(
              // Rows apart on a hairline that gives way under the pointer.
              "peer relative col-span-full grid min-h-9 cursor-default grid-cols-subgrid items-center rounded-[6px] px-2 text-left focus-ring-inset transition-colors duration-100 outline-none hover:bg-foreground/6",
              i > 0 &&
                "before:absolute before:inset-x-2 before:-top-px before:border-t before:border-border/60 hover:before:border-transparent [.peer:hover+&]:before:border-transparent",
              empty && "text-muted-foreground opacity-60 hover:bg-transparent",
            )}
          >
            <span aria-hidden className="grid text-primary">
              {selected ? <Check className="size-4" /> : null}
            </span>
            <span className={cn("truncate", selected && "font-semibold")}>{name}</span>
            <span className={cn("-ml-1.5", complete ? "font-semibold text-success" : "text-muted-foreground")}>
              {sums.viewed}/{sums.files}
            </span>
            <span className="ml-5 flex items-center gap-1.5 justify-self-end">
              <span className="text-success">+{sums.additions}</span>
              <span className="text-destructive">−{sums.deletions}</span>
              <Diffstat additions={sums.additions} deletions={sums.deletions} />
            </span>
            <span className="justify-self-end font-semibold">{left}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterBar({
  files,
  filters,
  chosen,
  shown,
  next,
  isViewed,
  minutesOf,
  learned,
  onToggle,
  onNextFile,
}: Props) {
  const t = useT();
  const done = shown.files > 0 && shown.minutesLeft === 0;
  const label = nextLabel(next, t);
  const stuck = !next.left && !next.nextFilter;
  const chip = (id: string, name: string, count: number) => {
    const pressed = id ? chosen.includes(id) : chosen.length === 0;
    return (
      <button
        key={id || "all"}
        type="button"
        aria-pressed={pressed}
        aria-keyshortcuts={id ? undefined : "Alt+Shift+0"}
        title={id ? undefined : t("review.showAll", { shortcut: chord("0") })}
        onClick={() => {
          onToggle(id);
        }}
        className={cn(
          // Toggle buttons: the ones on in the accent, no highlight under the pointer.
          "flex h-8 shrink-0 cursor-default items-center gap-1.5 rounded-[8px] pr-2 pl-3 text-body font-medium focus-ring transition-colors duration-150 outline-none",
          pressed ? "bg-primary text-primary-foreground" : "hover:bg-foreground/6 active:bg-fill",
          count === 0 && !pressed && "text-muted-foreground",
        )}
      >
        {name}
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-subheadline leading-[18px] font-semibold tabular-nums",
            pressed ? "bg-black/16" : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a floating flex bar, which a <fieldset> doesn't lay out reliably in WebKit.
      role="group"
      aria-label={t("review.reviewOnePart")}
      aria-keyshortcuts={filters.length > 0 ? "Alt+Shift+. Alt+Shift+," : undefined}
      // Floats over the code on the system's menu material (opaque with Reduce Transparency).
      className="absolute inset-x-4 bottom-4 isolate z-20 mx-auto flex w-fit max-w-[calc(100%-2rem)] [scrollbar-width:none] items-center gap-1 overflow-x-auto rounded-[12px] border border-border bg-popover p-1.5 shadow-(--shadow-menu)"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-[8px] text-muted-foreground"
              aria-label={label}
              aria-disabled={stuck}
              aria-keyshortcuts="Alt+Shift+J"
              onClick={() => {
                if (!stuck) onNextFile();
              }}
            />
          }
        >
          <ChevronsDown className={cn(stuck && "opacity-50")} />
        </TooltipTrigger>
        <TooltipContent>
          {label} {stuck ? null : <Kbd>{chord("J")}</Kbd>}
        </TooltipContent>
      </Tooltip>
      {filters.length > 0 ? (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          {/* Neighbours both on read as one pill, as in the extension (index.css). */}
          <span data-join="row" className="flex shrink-0 items-center gap-1">
            {chip("", t("review.all"), files.length)}
            {filters.map((f) => chip(f.id, f.name, files.filter((x) => inFilter(f, x.path)).length))}
          </span>
        </>
      ) : null}
      {/* The files left, the lines they change and the time they take, each after its icon. */}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <span className="flex shrink-0 items-center gap-3.5 px-1 text-body font-medium whitespace-nowrap text-muted-foreground tabular-nums">
        <span
          className="flex items-center gap-1.5"
          aria-label={t("common.files", { count: shown.files - shown.viewed })}
        >
          <FileText className="size-4" aria-hidden />
          {shown.files - shown.viewed}
        </span>
        <span
          className="flex items-center gap-1.5"
          aria-label={t("review.linesInView", { additions: shown.additions, deletions: shown.deletions })}
        >
          <span className="text-success">+{shown.additions}</span>
          <span className="text-destructive">−{shown.deletions}</span>
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- reachable from the keyboard so its tooltip (how the time is worked out) can be read.
                tabIndex={0}
                className="flex items-center gap-1.5 rounded-md focus-ring outline-none"
                aria-label={
                  done
                    ? t("review.doneLabel")
                    : t("review.aboutLeft", { time: t.duration(shown.minutesLeft).replace(/^~/u, "") })
                }
              />
            }
          >
            {done ? (
              <span className="flex h-[22px] animate-in items-center gap-1 rounded-full bg-success/6 pr-2.5 pl-1.5 font-semibold text-success shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--success)_35%,transparent)] duration-300 fade-in-0 zoom-in-75 motion-reduce:animate-none">
                <CircleCheck className="size-3.5" aria-hidden /> {t("review.done")}
              </span>
            ) : (
              <>
                <Clock className="size-4" aria-hidden />
                {t.duration(shown.minutesLeft)}
              </>
            )}
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{timeHint(learned, t)}</TooltipContent>
        </Tooltip>
      </span>
      {filters.length > 0 ? (
        <Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 rounded-[8px] text-muted-foreground aria-expanded:bg-foreground/6 aria-expanded:text-foreground"
                      aria-label={t("review.breakdown")}
                    />
                  }
                />
              }
            >
              <ChartBarStacked />
            </TooltipTrigger>
            <TooltipContent>{t("review.breakdownTitle")}</TooltipContent>
          </Tooltip>
          <PopoverContent
            side="top"
            align="center"
            sideOffset={10}
            className="w-max max-w-[min(560px,calc(100vw-2rem))] rounded-[12px] p-0"
          >
            <Breakdown
              files={files}
              filters={filters}
              chosen={chosen}
              isViewed={isViewed}
              minutesOf={minutesOf}
              learned={learned}
              onToggle={onToggle}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
