import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  ExternalLink,
  Rocket,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Face } from "@/components/avatar/avatar";
import { Button } from "@/components/button/button";
import { Picker, type Choice } from "@/components/picker/picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { bridge } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import { firstName } from "@/utils/copy/copy";
import type { Details } from "@/utils/details/details";
import { errorText } from "@/utils/error/error";
import { useT } from "@/utils/i18n/i18n";
import {
  addAssignees,
  addLabels,
  canTriage,
  labels as loadLabels,
  milestones as loadMilestones,
  people as loadPeople,
  removeAssignees,
  removeLabel,
  removeReviewRequests,
  requestReviews,
  setMilestone,
  teams as loadTeams,
  type Label,
  type Manage,
  type Milestone,
  type Person,
  type Reviewer,
  type Team,
} from "@/utils/manage/manage";

export function LabelChip({ label, className }: { label: Pick<Label, "name" | "color">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1.5 rounded-full bg-fill px-2 text-subheadline",
        className,
      )}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} aria-hidden />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function Section({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex h-5 items-center gap-2">
        <h3 id={id} className="flex-1 text-subheadline font-semibold text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const gear = (label: string) => (
  <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={label} />
);

const personChoice = (p: Person, selected: boolean): Choice => ({
  id: p.login,
  label: p.name || p.login,
  detail: p.name ? p.login : null,
  leading: <Face actor={p} />,
  selected,
});

function PeoplePicker({
  title,
  edit,
  choices,
  loading,
  onToggle,
  onQuery,
}: {
  title: string;
  edit: string;
  choices: Choice[];
  loading: boolean;
  onToggle: (id: string, on: boolean) => void;
  onQuery: (query: string) => void;
}) {
  const t = useT();
  return (
    <Picker
      title={title}
      placeholder={t("manage.searchPeople")}
      empty={t("manage.nobodyFound")}
      choices={choices}
      loading={loading}
      onPick={(c) => {
        onToggle(c.id, !c.selected);
      }}
      onQuery={onQuery}
      onOpenChange={(open) => {
        if (open) onQuery("");
      }}
      trigger={gear(edit)}
    >
      <Settings2 />
    </Picker>
  );
}

const STATE_TONE = {
  APPROVED: "text-success",
  CHANGES_REQUESTED: "text-destructive",
  COMMENTED: "text-muted-foreground",
  DISMISSED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
} as const;

type Props = { details: Details; pull: Pull; me: string | null; onError: (message: string) => void };

function useChange(pull: Pull, onError: Props["onError"]) {
  return async (optimistic: (m: Manage) => Manage, call: () => Promise<unknown>) => {
    pull.patch(optimistic);
    try {
      await call();
    } catch (e) {
      onError(errorText(e));
    } finally {
      void pull.reloadManage();
    }
  };
}

function Reviewers({ details, pull, me, onError }: Props) {
  const t = useT();
  const m = pull.manage;
  const change = useChange(pull, onError);
  const [candidates, setCandidates] = useState<{ people: Person[]; teams: Team[] }>({ people: [], teams: [] });
  const [loading, setLoading] = useState(false);
  const may = Boolean(m && details.state === "OPEN" && (canTriage(m) || details.viewerDidAuthor));
  const list: Reviewer[] =
    m?.reviewers ??
    details.reviewers.map((r) => ({
      key: r.team ? `team:${r.actor?.login}` : (r.actor?.login ?? ""),
      actor: r.team ? null : r.actor,
      team: r.team ? { slug: r.actor?.login ?? "", name: r.team, combinedSlug: "" } : null,
      state: r.state === "PENDING" ? null : r.state,
      requested: r.state === "PENDING",
      codeOwner: false,
    }));
  const fetch = (query: string) => {
    setLoading(true);
    void (async () => {
      await Promise.allSettled([
        loadPeople(details, query, (people) => {
          setCandidates((c) => ({ ...c, people }));
        }),
        m?.orgOwned
          ? loadTeams(details, query, (teams) => {
              setCandidates((c) => ({ ...c, teams }));
            })
          : Promise.resolve(),
      ]);
      setLoading(false);
    })();
  };
  const requested = new Set(list.filter((r) => r.requested).map((r) => r.key));
  const author = details.author?.login;
  const choices: Choice[] = [
    ...candidates.teams.map((team) => ({
      id: `team:${team.slug}`,
      label: team.name,
      detail: team.combinedSlug,
      leading: <TeamMark name={team.name} />,
      selected: requested.has(`team:${team.slug}`),
    })),
    ...candidates.people.filter((p) => p.login !== author).map((p) => personChoice(p, requested.has(p.login))),
  ];
  for (const r of list)
    if (r.requested && !choices.some((c) => c.id === r.key))
      choices.unshift({
        id: r.key,
        label: r.team?.name ?? firstName(r.actor, t),
        leading: r.team ? <TeamMark name={r.team.name} /> : <Face actor={r.actor} />,
        selected: true,
      });
  const toggle = (id: string, on: boolean) => {
    const team = id.startsWith("team:") ? id.slice(5) : null;
    const users = team ? [] : [id];
    const teamSlugs = team ? [team] : [];
    const person = candidates.people.find((p) => p.login === id) ?? null;
    const known = candidates.teams.find((x) => x.slug === team) ?? null;
    void change(
      (now) => {
        const others = now.reviewers.filter((r) => r.key !== id);
        const existing = now.reviewers.find((r) => r.key === id);
        if (!on)
          return {
            ...now,
            reviewers: existing?.state
              ? now.reviewers.map((r) => (r.key === id ? { ...r, requested: false } : r))
              : others,
          };
        return {
          ...now,
          reviewers: existing
            ? now.reviewers.map((r) => (r.key === id ? { ...r, requested: true } : r))
            : [
                ...now.reviewers,
                {
                  key: id,
                  actor: team ? null : person,
                  team: known,
                  state: null,
                  requested: true,
                  codeOwner: false,
                },
              ],
        };
      },
      () => (on ? requestReviews(details, users, teamSlugs) : removeReviewRequests(details, users, teamSlugs)),
    );
  };
  return (
    <Section
      id="reviewers"
      title={t("review.reviewers")}
      action={
        may ? (
          <PeoplePicker
            title={t("manage.requestReviewers")}
            edit={t("manage.editReviewers")}
            choices={choices}
            loading={loading}
            onToggle={toggle}
            onQuery={fetch}
          />
        ) : null
      }
    >
      {list.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {list.map((r) => (
            <li key={r.key} className="flex items-center gap-2 text-body">
              {r.team ? <TeamMark name={r.team.name} /> : <Face actor={r.actor} />}
              <span className="min-w-0 truncate">{r.team?.name ?? firstName(r.actor, t)}</span>
              {r.codeOwner ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="shrink-0 text-muted-foreground" />}>
                    <ShieldCheck className="size-3.5" aria-label={t("manage.codeOwner")} />
                  </TooltipTrigger>
                  <TooltipContent>{t("manage.codeOwnerTip")}</TooltipContent>
                </Tooltip>
              ) : null}
              <span
                className={cn("ml-auto shrink-0 text-callout", r.state ? STATE_TONE[r.state] : "text-muted-foreground")}
              >
                {r.requested && !r.state ? t("review.state.PENDING") : r.state ? t(`review.state.${r.state}`) : ""}
              </span>
              {may && r.state && !r.requested && r.actor && r.actor.login !== me ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="-mr-1 shrink-0 text-muted-foreground"
                        aria-label={t("manage.reRequest", { name: firstName(r.actor, t) })}
                        onClick={() => {
                          toggle(r.key, true);
                        }}
                      />
                    }
                  >
                    <RefreshCw />
                  </TooltipTrigger>
                  <TooltipContent>{t("manage.reRequestTip")}</TooltipContent>
                </Tooltip>
              ) : r.requested && r.state ? (
                <RefreshCw className="size-3 shrink-0 text-muted-foreground" aria-label={t("manage.askedAgain")} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-muted-foreground">{t("review.nobodyAsked")}</p>
      )}
      {m?.rule?.codeOwners ? (
        <p className="text-subheadline text-muted-foreground">{t("manage.codeOwnersRequired")}</p>
      ) : null}
      {m?.rule?.approvals ? (
        <p className="text-subheadline text-muted-foreground">
          {t("manage.approvalsRequired", { count: m.rule.approvals })}
        </p>
      ) : null}
    </Section>
  );
}

function TeamMark({ name }: { name: string }) {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" title={name}>
      <Users className="size-3" aria-hidden />
    </span>
  );
}

function Assignees({ details, pull, me, onError }: Props) {
  const t = useT();
  const m = pull.manage;
  const change = useChange(pull, onError);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const may = canTriage(m);
  const assigned = m?.assignees ?? [];
  const fetch = (query: string) => {
    setLoading(true);
    void loadPeople(details, query, setPeople).finally(() => {
      setLoading(false);
    });
  };
  const choices: Choice[] = people.map((p) =>
    personChoice(
      p,
      assigned.some((a) => a.login === p.login),
    ),
  );
  for (const a of assigned)
    if (!choices.some((c) => c.id === a.login))
      choices.unshift({ id: a.login, label: a.name || a.login, leading: <Face actor={a} />, selected: true });
  const toggle = (login: string, on: boolean) => {
    const person = people.find((p) => p.login === login) ?? assigned.find((p) => p.login === login);
    void change(
      (now) => ({
        ...now,
        assignees: on
          ? person
            ? [...now.assignees, person]
            : now.assignees
          : now.assignees.filter((a) => a.login !== login),
      }),
      () => (on ? addAssignees(details, [login]) : removeAssignees(details, [login])),
    );
  };
  return (
    <Section
      id="assignees"
      title={t("manage.assignees")}
      action={
        may ? (
          <PeoplePicker
            title={t("manage.assignTo")}
            edit={t("manage.editAssignees")}
            choices={choices}
            loading={loading}
            onToggle={toggle}
            onQuery={fetch}
          />
        ) : null
      }
    >
      {assigned.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {assigned.map((a) => (
            <li key={a.login} className="flex items-center gap-2 text-body">
              <Face actor={a} />
              <span className="truncate">{firstName(a, t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-muted-foreground">
          {t("manage.noAssignees")}
          {may && me && details.state === "OPEN" ? (
            <>
              {" "}
              <button
                type="button"
                className="cursor-default text-link underline-offset-2 focus-ring outline-none hover:underline"
                onClick={() => {
                  toggle(me, true);
                }}
              >
                {t("manage.assignYourself")}
              </button>
            </>
          ) : null}
        </p>
      )}
    </Section>
  );
}

function Labels({ details, pull, onError }: Props) {
  const t = useT();
  const m = pull.manage;
  const change = useChange(pull, onError);
  const [all, setAll] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const may = canTriage(m);
  const chosen = m?.labels ?? [];
  const choices: Choice[] = all.map((l) => ({
    id: l.name,
    label: l.name,
    detail: l.description,
    leading: <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: `#${l.color}` }} aria-hidden />,
    selected: chosen.some((c) => c.name === l.name),
  }));
  const toggle = (name: string, on: boolean) => {
    const label = all.filter((l) => l.name === name);
    void change(
      (now) => ({
        ...now,
        labels: on ? [...now.labels, ...label] : now.labels.filter((l) => l.name !== name),
      }),
      () => (on ? addLabels(details, [name]) : removeLabel(details, name)),
    );
  };
  return (
    <Section
      id="labels"
      title={t("manage.labels")}
      action={
        may ? (
          <Picker
            title={t("manage.applyLabels")}
            placeholder={t("manage.filterLabels")}
            empty={t("manage.noLabelsFound")}
            choices={choices}
            loading={loading}
            onPick={(c) => {
              toggle(c.id, !c.selected);
            }}
            onOpenChange={(open) => {
              if (!open) return;
              setLoading(true);
              void loadLabels(details, setAll).finally(() => {
                setLoading(false);
              });
            }}
            trigger={gear(t("manage.editLabels"))}
          >
            <Settings2 />
          </Picker>
        ) : null
      }
    >
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((l) => (
            <li key={l.name} title={l.description ?? undefined} className="max-w-full">
              <LabelChip label={l} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-callout text-muted-foreground">{t("manage.noLabels")}</p>
      )}
    </Section>
  );
}

function MilestoneSection({ details, pull, onError }: Props) {
  const t = useT();
  const m = pull.manage;
  const change = useChange(pull, onError);
  const [all, setAll] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const may = canTriage(m);
  const current = m?.milestone ?? null;
  const choices: Choice[] = all.map((x) => ({
    id: String(x.number),
    label: x.title,
    detail: x.dueOn
      ? t("manage.due", { date: new Date(x.dueOn).toLocaleDateString(t.locale, { dateStyle: "medium" }) })
      : null,
    selected: current?.number === x.number,
  }));
  if (current && !choices.some((c) => c.selected))
    choices.unshift({ id: String(current.number), label: current.title, selected: true });
  const pick = (c: Choice) => {
    const next = c.selected ? null : all.find((x) => String(x.number) === c.id)!;
    setOpen(false);
    void change(
      (now) => ({ ...now, milestone: next }),
      () => setMilestone(details, next?.number ?? null),
    );
  };
  return (
    <Section
      id="milestone"
      title={t("manage.milestone")}
      action={
        may ? (
          <Picker
            title={t("manage.setMilestone")}
            placeholder={t("manage.filterMilestones")}
            empty={t("manage.noMilestonesFound")}
            choices={choices}
            loading={loading}
            onPick={pick}
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) return;
              setLoading(true);
              void loadMilestones(details, setAll).finally(() => {
                setLoading(false);
              });
            }}
            trigger={gear(t("manage.editMilestone"))}
          >
            <Settings2 />
          </Picker>
        ) : null
      }
    >
      <p className={cn("text-callout", current ? "text-foreground" : "text-muted-foreground")}>
        {current?.title ?? t("manage.noMilestone")}
      </p>
    </Section>
  );
}

const ISSUE_ICON = {
  OPEN: { icon: CircleDot, className: "text-success" },
  COMPLETED: { icon: CircleCheck, className: "text-violet" },
  NOT_PLANNED: { icon: CircleSlash, className: "text-muted-foreground" },
} as const;

function Development({ pull, details }: { pull: Pull; details: Details }) {
  const t = useT();
  const issues = pull.manage?.issues ?? [];
  if (issues.length === 0) return null;
  return (
    <Section id="development" title={t("manage.development")}>
      <ul className="flex flex-col gap-1">
        {issues.map((issue) => {
          const s =
            issue.state === "OPEN"
              ? ISSUE_ICON.OPEN
              : issue.stateReason === "NOT_PLANNED"
                ? ISSUE_ICON.NOT_PLANNED
                : ISSUE_ICON.COMPLETED;
          return (
            <li key={issue.id}>
              <button
                type="button"
                className="-mx-1 flex w-[calc(100%+0.5rem)] cursor-default items-start gap-2 rounded-(--radius-row) px-1 py-0.5 text-left text-body focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-fill"
                onClick={() => void bridge.openUrl(issue.url)}
              >
                <s.icon
                  className={cn("mt-0.5 size-3.5 shrink-0", s.className)}
                  aria-label={t(issue.state === "OPEN" ? "manage.issueOpen" : "manage.issueClosed")}
                />
                <span className="min-w-0">
                  <span className="line-clamp-2">{issue.title}</span>
                  <span className="text-subheadline text-muted-foreground tabular-nums">
                    {issue.repo === `${details.owner}/${details.repo}` ? "" : issue.repo}#{issue.number}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-subheadline text-muted-foreground">{t("manage.closesWhenMerged")}</p>
    </Section>
  );
}

const DEPLOY_STATE: Record<string, "success" | "failure" | "pending"> = {
  SUCCESS: "success",
  ACTIVE: "success",
  FAILURE: "failure",
  ERROR: "failure",
  IN_PROGRESS: "pending",
  QUEUED: "pending",
  PENDING: "pending",
  WAITING: "pending",
};
const DEPLOY_TONE = {
  success: "text-success",
  failure: "text-destructive",
  pending: "text-warning",
  inactive: "text-muted-foreground",
} as const;

function Deployments({ pull }: { pull: Pull }) {
  const t = useT();
  const deployments = pull.manage?.deployments ?? [];
  if (deployments.length === 0) return null;
  const latest = [...new Map(deployments.map((d) => [d.environment, d])).values()];
  return (
    <Section id="deployments" title={t("manage.deployments")}>
      <ul className="flex flex-col gap-1">
        {latest.map((d) => {
          const link = d.url ?? d.logUrl;
          const state = DEPLOY_STATE[d.state] ?? "inactive";
          return (
            <li key={d.id} className="flex items-center gap-2 text-body">
              <Rocket
                className={cn("size-3.5 shrink-0", DEPLOY_TONE[state])}
                aria-label={t(`manage.deploy.${state}`)}
              />
              <span className="min-w-0 flex-1 truncate">{d.environment}</span>
              <span className={cn("shrink-0 text-callout", DEPLOY_TONE[state])}>{t.since(Date.parse(d.at))}</span>
              {link?.startsWith("https://") ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 text-muted-foreground"
                  aria-label={t("manage.openDeployment", { environment: d.environment })}
                  onClick={() => void bridge.openUrl(link)}
                >
                  <ExternalLink />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function Sidebar(props: Props) {
  return (
    <>
      <Reviewers {...props} />
      <Assignees {...props} />
      <Labels {...props} />
      <MilestoneSection {...props} />
      <Development pull={props.pull} details={props.details} />
      <Deployments pull={props.pull} />
    </>
  );
}
