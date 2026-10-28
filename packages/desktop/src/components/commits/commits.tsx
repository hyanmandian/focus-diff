// A pull request's commits, and choosing which of its changes the diff shows. In the Overview, the
// list (who, what, whether it's signed, how its checks went) with force pushes where they happened;
// a commit opens its own changes in the diff. In the toolbar, the range picker: all changes, what's
// new since your last review, one commit, or a run of them (shift-click), as on GitHub.

import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  GitCommitHorizontal,
  History,
  Loader2,
  Upload,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/button/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/collapsible/collapsible";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/popover/popover";
import { Face } from "@/components/sidebar/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { cn } from "@/utils/cn/cn";
import {
  commitRange,
  inRange,
  sameRange,
  type Ci,
  type Commit,
  type Commits as List,
  type Range,
} from "@/utils/commits/commits";
import { useT, type T } from "@/utils/i18n/i18n";

const CI_ICON = {
  success: { icon: CircleCheck, className: "text-success" },
  failure: { icon: CircleX, className: "text-destructive" },
  pending: { icon: CircleDot, className: "text-warning" },
} as const;

function CiMark({ ci }: { ci: Ci }) {
  const t = useT();
  if (!ci) return null;
  const s = CI_ICON[ci];
  return <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-label={t(`review.check.${ci}`)} />;
}

function Verified({ verified }: { verified: boolean | null }) {
  const t = useT();
  if (verified === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 text-footnote",
              verified ? "bg-success/10 text-success" : "bg-fill text-muted-foreground",
            )}
          />
        }
      >
        {verified ? <BadgeCheck className="inline size-3" aria-hidden /> : null}{" "}
        {verified ? t("manage.verified") : t("manage.unverified")}
      </TooltipTrigger>
      <TooltipContent>{verified ? t("manage.verifiedTip") : t("manage.unverifiedTip")}</TooltipContent>
    </Tooltip>
  );
}

/** What a range is called: "All changes", "Since your last review", "a1b2c3d", "3 commits". */
export function rangeLabel(range: Range, list: List | null, since: Pull["since"], t: T) {
  if (!range) return t("manage.allChanges");
  if (since && sameRange(range, since.range)) return t("manage.sinceReview");
  const shown = list ? inRange(list.commits, range) : [];
  if (shown.length === 1) return list!.commits[shown[0]!]!.short;
  if (shown.length > 0) return t("manage.commitCount", { count: shown.length });
  return `${range.from.slice(0, 7)}…${range.to.slice(0, 7)}`;
}

type Row =
  | { kind: "commit"; commit: Commit; index: number }
  | { kind: "push"; at: string; actor: string | null; before: string | null; after: string | null };

/** The commits with the force pushes between them, by time. */
function rows(list: List): Row[] {
  const all: Row[] = [
    ...list.commits.map((commit, index) => ({ kind: "commit" as const, commit, index })),
    ...list.forcePushes.map((p) => ({ kind: "push" as const, ...p })),
  ];
  const at = (r: Row) => Date.parse(r.kind === "commit" ? r.commit.at : r.at);
  return all.toSorted((a, b) => at(a) - at(b));
}

/** The Overview's list of commits; a click opens that commit in the diff. */
export function CommitsSection({ pull, onOpen }: { pull: Pull; onOpen: (range: Range) => void }) {
  const t = useT();
  const list = pull.commits;
  const [open, setOpen] = useState(false);
  if (!list?.commits.length) return null;
  const since = pull.since;
  return (
    <section aria-labelledby="commits" className="rounded-xl border bg-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <h2 className="flex min-w-0 flex-1">
            <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-default items-center gap-2 rounded text-left focus-ring outline-none">
              {open ? (
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span id="commits" className="text-headline font-bold">
                {t("manage.commits")}{" "}
                <span className="font-normal text-muted-foreground tabular-nums">{list.commits.length}</span>
              </span>
              {list.forcePushes.length > 0 ? (
                <span className="truncate text-callout text-muted-foreground">
                  {t("manage.forcePushes", { count: list.forcePushes.length })}
                </span>
              ) : null}
            </CollapsibleTrigger>
          </h2>
          {since ? (
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => {
                onOpen(since.range);
              }}
            >
              <History />{" "}
              {since.rewritten
                ? t("manage.sinceReviewRewritten")
                : t("manage.sinceReviewCount", { count: since.count })}
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          <ol className="flex flex-col border-t px-2 py-1.5">
            {rows(list).map((row) =>
              row.kind === "commit" ? (
                <li key={row.commit.oid}>
                  <button
                    type="button"
                    className="flex w-full cursor-default items-center gap-2 rounded-(--radius-row) px-2 py-1 text-left text-body focus-ring-inset outline-none hover:bg-fill"
                    onClick={() => {
                      onOpen(commitRange(list.commits, row.index, row.index));
                    }}
                    title={row.commit.body ? `${row.commit.headline}\n\n${row.commit.body}` : row.commit.headline}
                  >
                    <Face
                      actor={{
                        login: row.commit.author.login ?? row.commit.author.name,
                        avatarUrl: row.commit.author.avatarUrl ?? undefined,
                      }}
                      className="size-4"
                    />
                    <span className="min-w-0 flex-1 truncate">{row.commit.headline}</span>
                    {list.reviewed === row.commit.oid ? (
                      <span className="shrink-0 text-footnote text-muted-foreground">
                        {t("manage.youReviewedHere")}
                      </span>
                    ) : null}
                    <Verified verified={row.commit.verified} />
                    <CiMark ci={row.commit.ci} />
                    <span className="shrink-0 font-mono text-subheadline text-muted-foreground">
                      {row.commit.short}
                    </span>
                    <span className="w-8 shrink-0 text-right text-subheadline text-muted-foreground tabular-nums">
                      {t.since(Date.parse(row.commit.at))}
                    </span>
                  </button>
                </li>
              ) : (
                <li
                  key={`push:${row.at}`}
                  className="flex items-center gap-2 px-2 py-1 text-callout text-muted-foreground"
                >
                  <Upload className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {t("manage.forcePushed", {
                      who: row.actor ?? t("common.someone"),
                      from: row.before?.slice(0, 7) ?? "?",
                      to: row.after?.slice(0, 7) ?? "?",
                    })}
                  </span>
                  <span className="w-8 shrink-0 text-right text-subheadline tabular-nums">
                    {t.since(Date.parse(row.at))}
                  </span>
                </li>
              ),
            )}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/** The toolbar's range picker: a popover with all changes, since your last review and the commits;
 *  shift-click (or shift and the arrows) picks a run of them. */
export function RangePicker({
  pull,
  className,
  open,
  onOpenChange,
}: {
  pull: Pull;
  className: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const list = pull.commits;
  const { range, setRange, since } = pull;
  const [anchor, setAnchor] = useState<number | null>(null);
  const shown = new Set(list && range ? inRange(list.commits, range) : []);
  const pick = (commits: Commit[], index: number, extend: boolean) => {
    const from = extend && anchor !== null ? anchor : index;
    if (!extend) setAnchor(index);
    setRange(commitRange(commits, from, index));
    if (!extend) onOpenChange(false);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className={cn(className, "gap-1", range && "text-primary")}
                  aria-label={t("manage.changesShown", { range: rangeLabel(range, list, since, t) })}
                />
              }
            />
          }
        >
          <GitCommitHorizontal />
          {/* Named only when it isn't all changes: the toolbar's room goes to the title otherwise. */}
          {range ? (
            <span className="max-w-32 truncate @max-[1100px]:sr-only">{rangeLabel(range, list, since, t)}</span>
          ) : null}
          <ChevronDown className="size-3 opacity-70" />
        </TooltipTrigger>
        <TooltipContent>{t("manage.chooseChanges")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 gap-1 p-2">
        <PopoverTitle className="px-1.5 pt-0.5 pb-1 text-subheadline font-semibold text-muted-foreground">
          {t("manage.chooseChanges")}
        </PopoverTitle>
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- choices with a second line, and shift-click for a run: a <select> can't.
          role="listbox"
          aria-label={t("manage.chooseChanges")}
          className="flex max-h-[min(28rem,70vh)] flex-col overflow-y-auto overscroll-contain"
        >
          <Choice
            selected={!range}
            onPick={() => {
              setRange(null);
              onOpenChange(false);
            }}
            label={t("manage.allChanges")}
            detail={list ? t("manage.commitCount", { count: list.commits.length }) : null}
          />
          {since ? (
            <Choice
              selected={sameRange(range, since.range)}
              onPick={() => {
                setRange(since.range);
                onOpenChange(false);
              }}
              label={t("manage.sinceReview")}
              detail={
                since.rewritten ? t("manage.sinceReviewRewritten") : t("manage.commitCount", { count: since.count })
              }
            />
          ) : null}
          <div className="mx-1.5 my-1 h-px bg-border" />
          {list ? (
            list.commits.map((c, i) => (
              <Choice
                key={c.oid}
                selected={Boolean(range) && shown.has(i)}
                onPick={(extend) => {
                  pick(list.commits, i, extend);
                }}
                label={c.headline}
                detail={`${c.short} · ${c.author.login ?? c.author.name} · ${t.since(Date.parse(c.at))}`}
              />
            ))
          ) : (
            <Loader2 className="m-2 size-4 animate-spin text-muted-foreground" aria-label={t("review.loading")} />
          )}
        </div>
        <p className="px-1.5 pt-1 text-subheadline text-muted-foreground">{t("manage.shiftClick")}</p>
      </PopoverContent>
    </Popover>
  );
}

function Choice({
  selected,
  onPick,
  label,
  detail,
}: {
  selected: boolean;
  onPick: (extend: boolean) => void;
  label: string;
  detail?: string | null;
}) {
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an option of the listbox above.
      role="option"
      aria-selected={selected}
      onClick={(e) => {
        onPick(e.shiftKey);
      }}
      className={cn(
        "flex min-h-(--menu-item-h) w-full shrink-0 cursor-default items-center gap-2 rounded-(--radius-menu-item) px-1.5 py-1 text-left text-body outline-none hover:bg-fill focus-visible:bg-(--selection-bg) focus-visible:text-(--selection-fg) focus-visible:**:text-(--selection-fg)",
        selected && "bg-(--selection-bg-inactive)",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", selected ? "bg-primary" : "bg-transparent")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? <span className="block truncate text-subheadline text-muted-foreground">{detail}</span> : null}
      </span>
    </button>
  );
}

/** Above the diff while a range shows: which, and the way back to all changes. */
export function RangeBanner({
  pull,
  loading,
  error,
  below = false,
}: {
  pull: Pull;
  loading: boolean;
  error: string | null;
  below?: boolean;
}) {
  const t = useT();
  const { range, setRange, commits, since } = pull;
  if (!range) return null;
  const older = commits && commits.commits.at(-1)?.oid !== range.to;
  return (
    // Floats over the top of the diff, as the filter bar does at its foot: the diff's layout stays.
    <output
      className={cn(
        "absolute left-1/2 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-popover py-1 pr-1 pl-3 text-callout shadow-(--shadow-menu)",
        below ? "top-12" : "top-2",
      )}
    >
      {loading ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <GitCommitHorizontal className="size-3.5 shrink-0 text-primary" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate">
        {error ?? t("manage.showingRange", { range: rangeLabel(range, commits, since, t) })}
        {older && !error ? <span className="text-muted-foreground"> · {t("manage.olderVersion")}</span> : null}
      </span>
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => {
          setRange(null);
        }}
      >
        {t("manage.showAllChanges")}
      </Button>
    </output>
  );
}
