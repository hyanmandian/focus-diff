import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  History,
  Loader2,
  MessageSquare,
  RotateCw,
  Square,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AiAnswer, AiInline } from "@/components/ai-answer/ai-answer";
import { Button } from "@/components/button/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/collapsible/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { FileIcon } from "@/components/file-icon/file-icon";
import { Progress } from "@/components/progress/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import type { AnalysisState } from "@/hooks/use-analysis/use-analysis";
import type { Finding } from "@/utils/ai/ai";
import { cn } from "@/utils/cn/cn";
import { useDiagrams } from "@/utils/diagrams/diagrams";
import { useT } from "@/utils/i18n/i18n";
import { leftOutAs, type LeftOut } from "@/utils/review-scope/review-scope";
import type { ReviewFile } from "@/utils/review/review";
import { branches, pathsOf, type Section, type Step, type Stop } from "@/utils/walkthrough/walkthrough";

type Open = (path: string, line: number | null) => void;

const CAPTION = "text-subheadline font-semibold text-muted-foreground";

function FileRow({
  stop,
  file,
  viewed,
  onOpen,
}: {
  stop: Stop;
  file: ReviewFile | undefined;
  viewed: boolean;
  onOpen: Open;
}) {
  const t = useT();
  const name = stop.path.slice(stop.path.lastIndexOf("/") + 1);
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen(stop.path, stop.line ?? null);
        }}
        title={stop.path}
        className="flex w-full cursor-default items-start gap-2 rounded-[7px] px-2 py-1.5 text-left focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-foreground/5"
      >
        <FileIcon path={stop.path} className="mt-0.5 size-3.5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-1.5 text-callout">
            <span className="truncate font-mono">
              <span className="sr-only">{stop.path}</span>
              <span aria-hidden>{name}</span>
            </span>
            {stop.line ? (
              <span className="shrink-0 font-mono text-subheadline text-muted-foreground tabular-nums">
                L{stop.line}
                {stop.end ? `–${stop.end}` : ""}
              </span>
            ) : null}
            {file ? (
              <span className="ml-auto shrink-0 text-subheadline tabular-nums">
                <span className="text-success">+{file.additions}</span>{" "}
                <span className="text-destructive">−{file.deletions}</span>
              </span>
            ) : null}
          </span>
          {stop.note ? (
            <span className="text-callout text-muted-foreground">
              <AiInline text={stop.note} />
            </span>
          ) : null}
        </span>
        <span className="grid size-3.5 shrink-0 place-items-center pt-0.5">
          {viewed ? <Check className="size-3.5 text-success" aria-label={t("walkthrough.reviewed")} /> : null}
        </span>
      </button>
    </li>
  );
}

function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-6 cursor-default items-center gap-1 rounded px-2 text-callout font-medium text-muted-foreground focus-ring outline-none hover:text-foreground">
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Diagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pre = document.createElement("pre");
    pre.dataset.mermaid = "";
    pre.textContent = source;
    ref.current?.replaceChildren(pre);
  }, [source]);
  useDiagrams(ref, source);
  return (
    <div
      ref={ref}
      className="[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-callout"
    />
  );
}

function Change({ before, after }: { before: string; after: string }) {
  const t = useT();
  if (!before && !after) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-callout leading-relaxed">
      {before ? (
        <>
          <dt className={CAPTION}>{t("walkthrough.before")}</dt>
          <dd className="text-muted-foreground">
            <AiInline text={before} />
          </dd>
        </>
      ) : null}
      {after ? (
        <>
          <dt className={CAPTION}>{t("walkthrough.after")}</dt>
          <dd>
            <AiInline text={after} />
          </dd>
        </>
      ) : null}
    </dl>
  );
}

const SIGN = { added: "+", removed: "−", same: " " } as const;

function Flow({ flow, onOpen }: { flow: Step[]; onOpen: Open }) {
  const t = useT();
  const id = useId();
  if (flow.length === 0) return null;
  const tree = branches(flow);
  return (
    <figure aria-labelledby={id} className="flex flex-col gap-1">
      <figcaption id={id} className={CAPTION}>
        {t("walkthrough.flow")}
      </figcaption>
      <ol className="rounded-lg border bg-muted/40 py-1 font-mono text-subheadline">
        {flow.map((step, i) => {
          const code = (
            <>
              <span className="text-muted-foreground select-none" aria-hidden>
                {tree[i]}
              </span>
              <span
                className={cn(
                  step.change === "removed" && "text-muted-foreground line-through decoration-destructive/50",
                )}
              >
                {step.code}
              </span>
            </>
          );
          return (
            <li
              key={`${String(i)}-${step.code}`}
              className={cn(
                "flex items-center gap-2 px-2 leading-5",
                step.change === "added" && "bg-success/8",
                step.change === "removed" && "bg-destructive/8",
              )}
            >
              <span
                className={cn(
                  "w-2 shrink-0 select-none",
                  step.change === "added" ? "text-success" : "text-destructive",
                )}
              >
                {step.change === "same" ? null : (
                  <span aria-label={t(`walkthrough.step.${step.change}`)}>{SIGN[step.change]}</span>
                )}
              </span>
              {step.path ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpen(step.path!, step.line ?? null);
                  }}
                  title={`${step.path}${step.line ? `:${String(step.line)}` : ""}`}
                  className="min-w-0 flex-1 cursor-default truncate rounded text-left whitespace-pre focus-ring outline-none hover:underline"
                >
                  {code}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate whitespace-pre" title={step.code}>
                  {code}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function Deepen({ state, index }: { state: AnalysisState; index: number }) {
  const t = useT();
  return state.deepening(index) ? (
    <output className="flex items-center gap-2 text-callout text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      {t("walkthrough.deepening")}
      <Button
        variant="outline"
        size="xs"
        className="ml-auto"
        onClick={() => {
          state.stopPart(index);
        }}
      >
        <Square className="size-2.5 fill-current" aria-hidden /> {t("review.stop")}
      </Button>
    </output>
  ) : (
    <Button variant="outline" size="sm" className="self-start" onClick={() => void state.deepen(index)}>
      {t("walkthrough.deepen")}
    </Button>
  );
}

const FIRST = 8;

function Detail({ section, index, rail }: { section: Section; index: number; rail: RailProps }) {
  const t = useT();
  const byPath = new Map(rail.files.map((f) => [f.path, f]));
  const row = (stop: Stop) => (
    <FileRow
      key={stop.path}
      stop={stop}
      file={byPath.get(stop.path)}
      viewed={rail.isViewed(stop.path)}
      onOpen={rail.onOpen}
    />
  );
  if (section.kind === "rest") {
    const groups = new Map<LeftOut | "rest", Stop[]>();
    for (const stop of section.files) {
      const reason = leftOutAs(stop.path) ?? "rest";
      groups.set(reason, [...(groups.get(reason) ?? []), stop]);
    }
    return (
      <div className="-mx-2 flex flex-col gap-1 pb-4">
        <p className="px-2 pb-1 text-callout text-muted-foreground">{t("walkthrough.restSummary")}</p>
        {[...groups].map(([reason, stops]) => (
          <More key={reason} label={`${t(`walkthrough.reason.${reason}`)} · ${stops.length}`}>
            <ul className="flex flex-col">{stops.map((stop) => row(stop))}</ul>
          </More>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 pb-5">
      {section.summary ? <AiAnswer text={section.summary} /> : null}
      <Change before={section.before} after={section.after} />
      {section.diagram ? <Diagram source={section.diagram} /> : null}
      <Flow flow={section.flow} onOpen={rail.onOpen} />
      <div className="-mx-2 flex flex-col gap-1">
        <h3 className={cn(CAPTION, "px-2")}>
          {t("walkthrough.files", { count: section.files.length + section.alike.length })}
        </h3>
        <ul className="flex flex-col">{section.files.slice(0, FIRST).map((stop) => row(stop))}</ul>
        {section.files.length > FIRST ? (
          <More label={t("walkthrough.moreFiles", { count: section.files.length - FIRST })}>
            <ul className="flex flex-col">{section.files.slice(FIRST).map((stop) => row(stop))}</ul>
          </More>
        ) : null}
        {section.alike.length > 0 ? (
          <More label={t("walkthrough.alike", { count: section.alike.length })}>
            {section.alikeNote ? (
              <p className="px-2 pb-1 text-callout text-muted-foreground">
                <AiInline text={section.alikeNote} />
              </p>
            ) : null}
            <ul className="flex flex-col">{section.alike.map((stop) => row(stop))}</ul>
          </More>
        ) : null}
      </div>
      {rail.state.partError(index) ? (
        <p role="alert" className="text-callout text-destructive">
          {rail.state.partError(index)}
        </p>
      ) : null}
      {section.deep ? null : <Deepen state={rail.state} index={index} />}
    </div>
  );
}

function Running({ state, count }: { state: AnalysisState; count: number }) {
  const t = useT();
  return (
    <output className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="font-medium text-foreground">{t("walkthrough.building", { count })}</span>
      <Button variant="outline" size="xs" className="ml-auto" onClick={state.stop}>
        <Square className="size-2.5 fill-current" aria-hidden /> {t("review.stop")}
      </Button>
      <span className="basis-full">{t("walkthrough.buildingHint")}</span>
    </output>
  );
}

function Runs({ state }: { state: AnalysisState }) {
  const t = useT();
  const shown = state.record;
  const runs = state.runs.filter((r) => r.status !== "running").toReversed();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={t("walkthrough.history")} />}
            />
          }
        >
          <History />
        </TooltipTrigger>
        <TooltipContent>{t("walkthrough.history")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuRadioGroup
          value={shown?.id ?? ""}
          onValueChange={(id: string) => {
            state.show(id);
          }}
        >
          <DropdownMenuLabel>{t("walkthrough.history")}</DropdownMenuLabel>
          {runs.map((run) => (
            <DropdownMenuRadioItem key={run.id} value={run.id} disabled={run.status !== "done"} closeOnClick>
              <span className="tabular-nums">{t.ago(run.at)}</span>
              <span className="font-mono text-muted-foreground">{run.head.slice(0, 7)}</span>
              {run.status === "failed" || run.status === "stopped" ? (
                <span className="text-muted-foreground">· {t(`walkthrough.${run.status}`)}</span>
              ) : null}
              {run.archived ? <span className="text-muted-foreground">· {t("walkthrough.archived")}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {shown ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                state.archive(shown.id, !shown.archived);
              }}
            >
              {shown.archived ? t("walkthrough.unarchive") : t("walkthrough.archive")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Overview({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className={cn("text-callout leading-relaxed text-muted-foreground", !open && "line-clamp-3")}>
        <AiInline text={text} />
      </div>
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
        className="cursor-default rounded text-subheadline font-medium text-muted-foreground focus-ring outline-none hover:text-foreground"
      >
        {open ? t("walkthrough.less") : t("walkthrough.more")}
      </button>
    </div>
  );
}

function Marks({ section, comments }: { section: Section; comments: number }) {
  const t = useT();
  const skim = section.weight === "low" && section.kind !== "rest";
  const kind = section.kind === "pattern" || section.kind === "exception" ? section.kind : null;
  if (section.weight !== "high" && !skim && !kind && comments === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-subheadline text-muted-foreground">
      {section.weight === "high" ? (
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Eye className="size-3" aria-hidden /> {t("walkthrough.weight.high")}
        </span>
      ) : null}
      {skim ? <span>{t("walkthrough.weight.low")}</span> : null}
      {kind ? (
        <span className="flex items-center gap-1.5">
          <span
            className={cn("size-1.5 rounded-full", kind === "pattern" ? "bg-muted-foreground" : "bg-warning")}
            aria-hidden
          />
          {t(`walkthrough.kind.${kind}`)}
        </span>
      ) : null}
      {comments > 0 ? (
        <span className="flex items-center gap-1" title={t("walkthrough.comments", { count: comments })}>
          <MessageSquare className="size-3" aria-hidden />
          <span className="sr-only">{t("walkthrough.comments", { count: comments })}</span>
          <span aria-hidden className="tabular-nums">
            {comments}
          </span>
        </span>
      ) : null}
    </span>
  );
}

type RailProps = {
  state: AnalysisState;
  provider: string;
  files: ReviewFile[];
  findings: Finding[];
  at: number;
  isViewed: (path: string) => boolean;
  onPick: (index: number) => void;
  onOpen: Open;
};

export function WalkthroughRail(rail: RailProps) {
  const t = useT();
  const { state, at } = rail;
  const sections = state.analysis?.walkthrough.sections ?? [];
  const done = (section: Section) => pathsOf(section).every((path) => rail.isViewed(path));
  const reviewed = sections.filter((section) => done(section)).length;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const box = list.current;
    const item = box?.children[at];
    if (!box || !item) return;
    const first = box.children[0]!;
    const until = performance.now() + 600;
    let frame = 0;
    const pin = () => {
      box.scrollTop = item.getBoundingClientRect().top - first.getBoundingClientRect().top;
      if (performance.now() < until) frame = requestAnimationFrame(pin);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
    };
    box.addEventListener("wheel", stop, { once: true, passive: true });
    pin();
    return () => {
      stop();
      box.removeEventListener("wheel", stop);
    };
  }, [at]);
  return (
    <aside className="flex w-[24rem] shrink-0 flex-col border-r" aria-label={t("walkthrough.tab")}>
      <header className="flex flex-col gap-3 border-b px-4 pt-3 pb-4">
        <div className="flex items-center gap-1.5">
          <h2 className="text-callout font-semibold">{t("walkthrough.tab")}</h2>
          <span className="min-w-0 truncate text-subheadline text-muted-foreground">
            {t("walkthrough.by", { provider: rail.provider })}
          </span>
          <span className="ml-auto flex items-center">
            <Runs state={state} />
            {state.building ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("walkthrough.buildAgain")}
                      onClick={() => void state.build()}
                    />
                  }
                >
                  <RotateCw />
                </TooltipTrigger>
                <TooltipContent>{t("walkthrough.buildAgain")}</TooltipContent>
              </Tooltip>
            )}
          </span>
        </div>
        <Overview text={state.analysis?.walkthrough.overview ?? ""} />
        {state.stale && !state.building ? (
          <output className="text-callout text-warning">{t("walkthrough.stale")}</output>
        ) : null}
        {state.building ? <Running state={state} count={state.split?.kept.length ?? 0} /> : null}
        {state.error ? (
          <p role="alert" className="text-callout text-destructive">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-2 text-subheadline text-muted-foreground">
          <Progress
            value={sections.length > 0 ? (reviewed / sections.length) * 100 : 0}
            className="flex-1"
            aria-label={t("walkthrough.progress", { done: reviewed, total: sections.length })}
          />
          <span className="tabular-nums">{t("walkthrough.progress", { done: reviewed, total: sections.length })}</span>
        </div>
      </header>
      <ol ref={list} className="stagger flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
        {sections.map((section, i) => {
          const current = i === at;
          const finished = done(section);
          const paths = new Set(pathsOf(section));
          return (
            <li
              key={pathsOf(section)[0]}
              className="relative before:absolute before:top-8 before:bottom-0 before:left-[1.1875rem] before:w-px before:bg-border last:before:hidden"
            >
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                aria-expanded={current}
                onClick={() => {
                  rail.onPick(i);
                }}
                className="group flex w-full cursor-default items-start gap-3 rounded-[10px] px-2 py-2 text-left focus-ring outline-none"
              >
                <span
                  className={cn(
                    "relative z-1 mt-px grid size-6 shrink-0 place-items-center rounded-full text-footnote font-semibold tabular-nums ring-4 ring-background transition-colors duration-(--duration-fast)",
                    finished
                      ? "bg-success text-white"
                      : current
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground group-hover:text-foreground",
                  )}
                  aria-hidden
                >
                  {finished ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                  <span
                    className={cn(
                      "leading-snug transition-colors duration-(--duration-fast)",
                      current
                        ? "text-headline font-semibold"
                        : cn(
                            "line-clamp-2 text-body group-hover:text-foreground",
                            finished ? "text-muted-foreground" : "text-foreground/85",
                          ),
                    )}
                  >
                    <span className="sr-only">{t("walkthrough.part", { index: String(i + 1) })}: </span>
                    {section.kind === "rest" ? t("walkthrough.rest") : section.title}
                  </span>
                  <Marks section={section} comments={rail.findings.filter((f) => paths.has(f.path)).length} />
                </span>
              </button>
              <Collapsible open={current}>
                <CollapsibleContent className="pr-2 pl-11">
                  <Detail section={section} index={i} rail={rail} />
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>
      <footer className="flex items-center gap-1 border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={at <= 0}
          onClick={() => {
            rail.onPick(at - 1);
          }}
        >
          <ArrowLeft aria-hidden /> {t("walkthrough.previous")}
        </Button>
        <span className="flex-1 text-center text-subheadline text-muted-foreground tabular-nums">
          {t("walkthrough.of", { at: at + 1, total: sections.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={at >= sections.length - 1}
          onClick={() => {
            rail.onPick(at + 1);
          }}
        >
          {t("walkthrough.next")} <ArrowRight aria-hidden />
        </Button>
      </footer>
    </aside>
  );
}

export function WalkthroughStart({
  state,
  provider,
  problem,
  onOpenSettings,
}: {
  state: AnalysisState;
  provider: string;
  problem: string | null;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const kept = state.split?.kept.length ?? 0;
  const leftOut = (state.split?.leftOut ?? []).reduce((sum, group) => sum + group.files.length, 0);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-8 py-10">
      <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-6" aria-labelledby="walk-title">
        <div className="flex w-full items-center gap-2">
          <h2 id="walk-title" className="text-title3 font-bold">
            {t("walkthrough.title")}
          </h2>
          {state.runs.some((r) => r.status === "done") ? (
            <span className="ml-auto">
              <Runs state={state} />
            </span>
          ) : null}
        </div>
        <p className="max-w-prose text-body text-muted-foreground">{t("walkthrough.intro", { provider })}</p>
        {state.split ? (
          <p className="text-callout text-muted-foreground">
            <span className="font-medium text-foreground">{t("walkthrough.toWalk", { count: kept })}</span>
            {leftOut > 0
              ? ` · ${t("walkthrough.leftOutCount", { count: leftOut })}. ${t("walkthrough.leftOutHint")}`
              : null}
          </p>
        ) : null}
        {problem ? (
          <p className="flex flex-wrap items-center gap-x-2 text-callout text-muted-foreground">
            {problem}
            <Button variant="link" size="xs" className="h-auto p-0" onClick={onOpenSettings}>
              {t("walkthrough.openSettings")}
            </Button>
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-callout text-destructive">
            {state.error}
          </p>
        ) : null}
        {state.split && kept === 0 ? (
          <p className="text-callout text-muted-foreground">{t("walkthrough.nothing")}</p>
        ) : state.building ? (
          <div className="w-full">
            <Running state={state} count={kept} />
          </div>
        ) : (
          <Button className="mt-1" onClick={() => void state.build()} disabled={!state.split}>
            {t("walkthrough.build")}
          </Button>
        )}
      </section>
    </div>
  );
}
