// The checks, all of them, grouped as GitHub groups them (failing, in progress, skipped,
// successful). Opening one shows what it says of itself, its steps, the lines it complains about
// (each a way to that line in the diff) and, for a GitHub Actions job, its log, scrolled to the
// first error. Re-running and approving fork runs are here for those allowed; while anything runs,
// the list follows it (checks.ts).

import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleX,
  ExternalLink,
  Loader2,
  RotateCw,
  TriangleAlert,
  Info,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ButtonGroup } from "@/components/button-group/button-group";
import { Button } from "@/components/button/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/collapsible/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { bridge } from "@/utils/bridge/bridge";
import {
  countChecks,
  groupChecks,
  loadCheckDetail,
  loadLog,
  parseLog,
  rerunJob,
  type CheckDetail,
  type CheckItem,
  type CheckState,
  type LogLine,
} from "@/utils/checks/checks";
import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";
import { canWrite } from "@/utils/manage/manage";
import type { PullRef } from "@/utils/review/review";

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
const DETAILS = [
  "cancelled",
  "timed_out",
  "skipped",
  "neutral",
  "action_required",
  "startup_failure",
  "stale",
  "failure",
  "error",
  "queued",
  "in_progress",
  "waiting",
  "pending",
  "requested",
  "expected",
] as const;
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
    const el = box.current!;
    const error = el.querySelector<HTMLElement>("[data-kind=error]");
    el.scrollTop = error ? error.offsetTop - 24 : el.scrollHeight;
    // A log is shown once, as it was loaded: placed when it appears.
  }, []);
  return (
    <div className="flex flex-col gap-1">
      {truncated ? <p className="text-subheadline text-muted-foreground">{t("manage.logTruncated")}</p> : null}
      <div
        ref={box}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a box that scrolls: the keyboard needs the focus in it to scroll it.
        tabIndex={0}
        role="log"
        aria-label={t("manage.log")}
        className="selectable relative max-h-96 overflow-auto rounded-lg bg-muted p-2 font-mono text-footnote leading-relaxed focus-ring outline-none"
      >
        {lines.map((line, i) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- a log's lines repeat, and a log never changes once shown.
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

function Opened({
  pr,
  check,
  write,
  hasFile,
  onJump,
  say,
}: {
  pr: PullRef;
  check: CheckItem;
  write: boolean;
  hasFile: (path: string) => boolean;
  onJump: (path: string, line: number | null) => void;
  say: (message: string) => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<CheckDetail | null>(null);
  const [log, setLog] = useState<{ lines: LogLine[]; truncated: boolean } | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const done = check.state !== "pending";
  // Asked again as the check's state changes: what it says of itself grows as it finishes.
  useEffect(() => {
    if (check.kind !== "run") return;
    let live = true;
    void (async () => {
      try {
        const d = await loadCheckDetail(check.id);
        if (live) setDetail(d);
      } catch {
        // Only the list's own words, then.
      }
    })();
    return () => {
      live = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- check.state is that "again".
  }, [check.id, check.kind, check.state]);
  const showLog = async (job: number) => {
    setLogLoading(true);
    setLogError(null);
    try {
      const got = await loadLog(pr, job, done);
      setLog({ lines: parseLog(got.text), truncated: got.truncated });
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e));
    } finally {
      setLogLoading(false);
    }
  };
  const rerun = async (job: number) => {
    try {
      await rerunJob(pr, job);
      say(t("manage.rerunning"));
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };
  const failedSteps = detail?.steps.filter((s) => s.state === "failure") ?? [];
  return (
    <div className="flex flex-col gap-2.5 pt-1.5 pb-2 pl-5.5">
      {check.description ? <p className="text-callout text-muted-foreground">{check.description}</p> : null}
      {failedSteps.length > 0 ? (
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
              // oxlint-disable-next-line react/no-array-index-key -- GitHub can say the same of one line twice; the list never changes order.
              <li key={i} className="rounded-lg border bg-background p-2">
                <div className="flex items-center gap-1.5">
                  <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-hidden />
                  <p className="min-w-0 flex-1 truncate font-mono text-subheadline text-muted-foreground">
                    {a.path}
                    {a.line ? `:${a.line}` : ""}
                  </p>
                  {hasFile(a.path) ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      onClick={() => {
                        onJump(a.path, a.line);
                      }}
                      aria-label={
                        a.line
                          ? t("review.showLineInDiff", { path: a.path, line: String(a.line) })
                          : t("review.showInDiff", { path: a.path })
                      }
                    >
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
      {detail?.summary ? (
        <p className="selectable line-clamp-[12] text-callout break-words whitespace-pre-wrap text-muted-foreground">
          {detail.summary}
        </p>
      ) : null}
      {log ? <LogView lines={log.lines} truncated={log.truncated} /> : null}
      {logError === null ? null : (
        <p className="text-callout text-muted-foreground" role="alert">
          {logError}
        </p>
      )}
      <ButtonGroup>
        {check.job && !log ? (
          <Button variant="outline" onClick={() => void showLog(check.job!)} disabled={logLoading || !done}>
            {logLoading ? <Loader2 className="animate-spin" /> : null}
            {done ? t("manage.showLog") : t("manage.logWhenDone")}
          </Button>
        ) : null}
        {write && check.job && done ? (
          <Button variant="outline" onClick={() => void rerun(check.job!)}>
            <RotateCw /> {t("manage.rerunJob")}
          </Button>
        ) : null}
        {check.url?.startsWith("https://") ? (
          <Button variant="outline" onClick={() => void bridge.openUrl(check.url!)}>
            <ExternalLink /> {t("review.openOnGitHub")}
          </Button>
        ) : null}
      </ButtonGroup>
    </div>
  );
}

function Row({ check, open, onToggle }: { check: CheckItem; open: boolean; onToggle: () => void }) {
  const t = useT();
  const s = CHECK_ICON[check.state];
  const time = took(check);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full cursor-default items-center gap-2 rounded py-0.5 text-left text-body focus-ring outline-none"
    >
      {open ? (
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
      {check.state === "pending" ? (
        <Loader2
          className={cn("size-3.5 shrink-0 animate-spin motion-reduce:animate-none", s.className)}
          aria-label={t(`review.check.${check.state}`)}
        />
      ) : (
        <s.icon className={cn("size-3.5 shrink-0", s.className)} aria-label={t(`review.check.${check.state}`)} />
      )}
      <span className="min-w-0 flex-1 truncate">
        {check.workflow ? <span className="text-muted-foreground">{check.workflow} / </span> : null}
        {check.name}
      </span>
      {check.required ? (
        <span className="shrink-0 rounded-full bg-fill px-1.5 text-footnote text-muted-foreground">
          {t("manage.required")}
        </span>
      ) : null}
      <span className="shrink-0 text-subheadline text-muted-foreground tabular-nums">
        {time ?? (check.state !== "success" && isDetail(check.detail) ? t(`manage.detail.${check.detail}`) : "")}
      </span>
    </button>
  );
}

type Props = {
  pr: PullRef & { state: string };
  pull: Pull;
  hasFile: (path: string) => boolean;
  onJump: (path: string, line: number | null) => void;
  say: (message: string) => void;
};

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
  if (checks.length === 0 && pull.awaiting.length === 0) return null;
  const summary = (["failure", "pending", "neutral", "success"] as CheckState[])
    .filter((s) => counts[s])
    .map((s) => t(`manage.count.${s}`, { count: counts[s] }));
  const toggle = (id: string) => {
    setOpened((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  };
  return (
    <section aria-labelledby="checks" className="rounded-xl border bg-card">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-default items-center gap-2 rounded text-left focus-ring outline-none">
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <h2 id="checks" className="text-headline font-bold">
              {t("review.checks")}
            </h2>
            <span className="truncate text-callout text-muted-foreground">{t.list(summary)}</span>
            {pull.checks.running ? (
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-label={t("review.check.pending")}
              />
            ) : null}
          </CollapsibleTrigger>
          {write && checks.some((c) => c.run) ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" className="shrink-0 gap-1" disabled={pull.busy === "rerun"} />}
              >
                <RotateCw /> {t("manage.rerun")}
                <ChevronDown className="size-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!failing}
                  onClick={() => {
                    pull.actions.rerun("failed");
                  }}
                >
                  {t("manage.rerunFailed")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    pull.actions.rerun("all");
                  }}
                >
                  {t("manage.rerunAll")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {pull.awaiting.length > 0 && write && pr.state === "OPEN" ? (
          <div className="mx-4 mb-2.5 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-callout">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
            <span className="min-w-0 flex-1">{t("manage.awaitingApproval", { count: pull.awaiting.length })}</span>
            <Button onClick={pull.actions.approve} disabled={pull.busy === "approve"}>
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
                      <Row
                        check={check}
                        open={opened.has(check.id)}
                        onToggle={() => {
                          toggle(check.id);
                        }}
                      />
                      {opened.has(check.id) ? (
                        <Opened pr={pr} check={check} write={write} hasFile={hasFile} onJump={onJump} say={say} />
                      ) : null}
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
