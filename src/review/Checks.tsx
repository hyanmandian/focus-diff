// The checks, all of them, grouped as GitHub groups them (failing, in progress, skipped,
// successful). Opening one shows what it says of itself, its steps, the lines it complains about
// (each a way to that line in the diff) and, for a GitHub Actions job, its log, scrolled to the
// first error. Re-running and approving fork runs are here for those allowed; while anything runs,
// the list follows it (checks.ts).

import { ArrowDownToLine, ChevronDown, ChevronRight, CircleCheck, CircleDot, CircleMinus, CircleX, ExternalLink, Loader2, RotateCw, TriangleAlert, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import { countChecks, groupChecks, loadCheckDetail, loadLog, parseLog, rerunJob, type CheckDetail, type CheckItem, type CheckState, type LogLine } from "@/lib/checks";
import { useT } from "@/lib/i18n";
import { canWrite } from "@/lib/manage";
import type { PullRef } from "@/lib/review";
import { cn } from "@/lib/utils";
import type { Pull } from "./usePull";

// Their words: t(`review.check.${state}`), t(`manage.group.${state}`).
export const CHECK_ICON = {
  success: { icon: CircleCheck, className: "text-success" },
  failure: { icon: CircleX, className: "text-destructive" },
  pending: { icon: CircleDot, className: "text-warning" },
  neutral: { icon: CircleMinus, className: "text-muted-foreground" },
} as const;

/** How long it ran: "42s", "3m 5s". */
function took(check: CheckItem) {
  if (!check.startedAt || !check.completedAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// GitHub's words for how a check went or where it is, in ours: t(`manage.detail.${detail}`).
const DETAILS = ["cancelled", "timed_out", "skipped", "neutral", "action_required", "startup_failure", "stale", "failure", "error", "queued", "in_progress", "waiting", "pending", "requested", "expected"] as const;
type Detail = (typeof DETAILS)[number];
const isDetail = (word: string): word is Detail => (DETAILS as readonly string[]).includes(word);

const LEVEL = {
  FAILURE: { icon: CircleX, className: "text-destructive" },
  WARNING: { icon: TriangleAlert, className: "text-warning" },
  NOTICE: { icon: Info, className: "text-muted-foreground" },
} as const;

function LogView({ lines, truncated }: { lines: LogLine[]; truncated: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  // At the first error, where a failure is explained; at the end otherwise.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const error = el.querySelector<HTMLElement>("[data-kind=error]");
    el.scrollTop = error ? error.offsetTop - 24 : el.scrollHeight;
  }, [lines]);
  return (
    <div className="flex flex-col gap-1">
      {truncated ? <p className="text-subheadline text-muted-foreground">{t("manage.logTruncated")}</p> : null}
      <div ref={box} tabIndex={0} role="log" aria-label={t("manage.log")} className="selectable relative max-h-96 overflow-auto rounded-lg bg-muted p-2 font-mono text-footnote leading-relaxed outline-none focus-ring">
        {lines.map((line, i) => (
          <div
            key={i}
            data-kind={line.kind}
            className={cn(
              "px-1 break-all whitespace-pre-wrap",
              line.kind === "group" && "mt-1 font-semibold text-foreground",
              line.kind === "error" && "rounded-sm bg-destructive/10 text-destructive",
              line.kind === "warning" && "rounded-sm bg-warning/10 text-warning",
              line.kind === "command" && "text-link",
            )}
          >
            {line.text || " "}
          </div>
        ))}
      </div>
    </div>
  );
}

function Opened({ pr, check, write, hasFile, onJump, say }: { pr: PullRef; check: CheckItem; write: boolean; hasFile: (path: string) => boolean; onJump: (path: string, line: number | null) => void; say: (message: string) => void }) {
  const t = useT();
  const [detail, setDetail] = useState<CheckDetail | null>(null);
  const [log, setLog] = useState<{ lines: LogLine[]; truncated: boolean } | null>(null);
  const [logState, setLogState] = useState<"idle" | "loading" | string>("idle");
  const done = check.state !== "pending";
  useEffect(() => {
    if (check.kind !== "run") return;
    let live = true;
    void loadCheckDetail(check.id)
      .then((d) => live && setDetail(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [check.id, check.kind, check.state]);
  const showLog = async () => {
    if (!check.job) return;
    setLogState("loading");
    try {
      const got = await loadLog(pr, check.job, done);
      setLog({ lines: parseLog(got.text), truncated: got.truncated });
      setLogState("idle");
    } catch (e) {
      setLogState(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    }
  };
  const failedSteps = detail?.steps.filter((s) => s.state === "failure") ?? [];
  return (
    <div className="flex flex-col gap-2.5 pt-1.5 pb-2 pl-5.5">
      {check.description ? <p className="text-callout text-muted-foreground">{check.description}</p> : null}
      {failedSteps.length ? (
        <ul className="flex flex-col gap-0.5" aria-label={t("manage.failedSteps")}>
          {failedSteps.map((s) => (
            <li key={s.number} className="flex items-center gap-1.5 text-callout">
              <CircleX className="size-3 shrink-0 text-destructive" aria-hidden />
              <span className="truncate">{s.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {detail?.annotations.length ? (
        <ul className="flex flex-col gap-1.5" aria-label={t("manage.annotations")}>
          {detail.annotations.map((a, i) => {
            const s = LEVEL[a.level];
            return (
              <li key={i} className="rounded-lg border bg-background p-2">
                <div className="flex items-center gap-1.5">
                  <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-hidden />
                  <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
                    {a.path}
                    {a.line ? `:${a.line}` : ""}
                  </p>
                  {hasFile(a.path) ? (
                    <Button variant="ghost" size="xs" className="shrink-0" onClick={() => onJump(a.path, a.line)} aria-label={a.line ? t("review.showLineInDiff", { path: a.path, line: String(a.line) }) : t("review.showInDiff", { path: a.path })}>
                      <ArrowDownToLine /> {a.line ? t("review.goToLine") : t("review.goToFile")}
                    </Button>
                  ) : null}
                </div>
                {a.title ? <p className="mt-1 text-callout font-medium">{a.title}</p> : null}
                <p className="selectable mt-0.5 text-callout break-words whitespace-pre-wrap">{a.message}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
      {detail?.summary ? <p className="selectable line-clamp-[12] text-callout break-words whitespace-pre-wrap text-muted-foreground">{detail.summary}</p> : null}
      {log ? <LogView lines={log.lines} truncated={log.truncated} /> : null}
      {logState !== "idle" && logState !== "loading" ? (
        <p className="text-callout text-muted-foreground" role="alert">
          {logState}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {check.job && !log ? (
          <Button variant="outline" size="xs" onClick={() => void showLog()} disabled={logState === "loading" || !done}>
            {logState === "loading" ? <Loader2 className="animate-spin" /> : null}
            {done ? t("manage.showLog") : t("manage.logWhenDone")}
          </Button>
        ) : null}
        {write && check.job && done ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void rerunJob(pr, check.job!)
                .then(() => say(t("manage.rerunning")))
                .catch((e: unknown) => say(e instanceof Error ? e.message : String(e)))
            }
          >
            <RotateCw /> {t("manage.rerunJob")}
          </Button>
        ) : null}
        {check.url?.startsWith("https://") ? (
          <Button variant="ghost" size="xs" onClick={() => void bridge.openUrl(check.url!)}>
            <ExternalLink /> {t("review.openOnGitHub")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Row({ check, open, onToggle }: { check: CheckItem; open: boolean; onToggle: () => void }) {
  const t = useT();
  const s = CHECK_ICON[check.state];
  const time = took(check);
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-default items-center gap-2 rounded py-0.5 text-left text-body outline-none focus-ring">
      {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
      {check.state === "pending" ? <Loader2 className={cn("size-3.5 shrink-0 animate-spin motion-reduce:animate-none", s.className)} aria-label={t(`review.check.${check.state}`)} /> : <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-label={t(`review.check.${check.state}`)} />}
      <span className="min-w-0 flex-1 truncate">
        {check.workflow ? <span className="text-muted-foreground">{check.workflow} / </span> : null}
        {check.name}
      </span>
      {check.required ? <span className="shrink-0 rounded-full bg-fill px-1.5 text-footnote text-muted-foreground">{t("manage.required")}</span> : null}
      <span className="shrink-0 text-subheadline text-muted-foreground tabular-nums">{time ?? (check.state !== "success" && isDetail(check.detail) ? t(`manage.detail.${check.detail}`) : "")}</span>
    </button>
  );
}

type Props = { pr: PullRef & { state: string }; pull: Pull; hasFile: (path: string) => boolean; onJump: (path: string, line: number | null) => void; say: (message: string) => void };

export function Checks({ pr, pull, hasFile, onJump, say }: Props) {
  const t = useT();
  const { checks } = pull.checks;
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const counts = countChecks(checks);
  const groups = groupChecks(checks);
  const write = canWrite(pull.manage);
  const failing = counts.failure > 0;
  // Open when something needs looking at; closed when everything passed.
  const [open, setOpen] = useState(failing || counts.pending > 0);
  if (!checks.length && !pull.awaiting.length) return null;
  const summary = (["failure", "pending", "neutral", "success"] as CheckState[])
    .filter((s) => counts[s])
    .map((s) => t(`manage.count.${s}`, { count: counts[s] }));
  const toggle = (id: string) => setOpened((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <section aria-labelledby="checks" className="rounded-xl border bg-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-default items-center gap-2 rounded text-left outline-none focus-ring">
            {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <h2 id="checks" className="text-headline font-bold">
              {t("review.checks")}
            </h2>
            <span className="truncate text-callout text-muted-foreground">{t.list(summary)}</span>
            {pull.checks.running ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("review.check.pending")} /> : null}
          </CollapsibleTrigger>
          {write && checks.some((c) => c.run) ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="shrink-0 gap-1 text-muted-foreground" disabled={pull.busy === "rerun"} />}>
                <RotateCw /> {t("manage.rerun")}
                <ChevronDown className="size-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!failing} onClick={() => pull.actions.rerun("failed")}>
                  {t("manage.rerunFailed")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => pull.actions.rerun("all")}>{t("manage.rerunAll")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {pull.awaiting.length && write && pr.state === "OPEN" ? (
          <div className="mx-4 mb-2.5 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-callout">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">{t("manage.awaitingApproval", { count: pull.awaiting.length })}</span>
            <Button size="xs" onClick={pull.actions.approve} disabled={pull.busy === "approve"}>
              {t("manage.approveAndRun")}
            </Button>
          </div>
        ) : null}
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3">
            {groups.map((g) => (
              <div key={g.state} className="flex flex-col gap-0.5">
                <h3 className="text-subheadline font-semibold text-muted-foreground">
                  {t(`manage.group.${g.state}`)} <span className="font-normal tabular-nums">{g.checks.length}</span>
                </h3>
                <ul className="flex flex-col">
                  {g.checks.map((check) => (
                    <li key={check.id}>
                      <Row check={check} open={opened.has(check.id)} onToggle={() => toggle(check.id)} />
                      {opened.has(check.id) ? <Opened pr={pr} check={check} write={write} hasFile={hasFile} onJump={onJump} say={say} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
