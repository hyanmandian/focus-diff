// Editing one queue: what puts a pull request in it, where, what to leave out, and what's worth a
// notification. Every change applies right away (Settings saves it).

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LEAVE_OUT, TONES, validPattern, type EventKind, type LeaveOut, type Queue, type QueueKind } from "@/lib/config";
import { i18n, useT, type T } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Group, PRESSED_CHIP, radioKeys, Row, SwitchRow, TONE_FILL } from "./Form";
import { TagInput } from "./TagInput";

/** Path filters to start from, the same as Focus Diff's recipes; `name` keys their words (settings.preset.*). */
const PATH_PRESETS: Array<{ name: "frontend" | "backend" | "code" | "infra" | "database" | "docs"; include: string; exclude: string }> = [
  { name: "frontend", include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: "\\.(test|spec|stories)\\." },
  { name: "backend", include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\." },
  { name: "code", include: "", exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/" },
  { name: "infra", include: "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$", exclude: "" },
  { name: "database", include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" },
  { name: "docs", include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" },
];

const KINDS: QueueKind[] = ["review", "involved", "authored", "merged", "custom"];

/** The events that can happen to the pull requests of each kind of queue. */
const KIND_EVENTS: Record<QueueKind, EventKind[]> = {
  review: ["new", "rerequest", "ready", "comment", "mention"],
  involved: ["new", "commits", "reply", "mention", "comment", "rerequest", "ready"],
  authored: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"],
  merged: ["new"],
  custom: ["new", "commits", "reply", "mention", "comment", "rerequest", "ready"],
};

/** What a queue's notifications can leave out that has a line under its name. */
const LEAVE_OUT_HINTS: Partial<Record<LeaveOut, "settings.leaveOut.bots.hint">> = { bots: "settings.leaveOut.bots.hint" };

const SKIPS: Array<Queue["skipIfI"]> = ["approved", "reviewed", "tookPart"];

// Called as a value is added, so they read the words then.
const repoError = (v: string) => (/^[\w.-]+\/(?:[\w.-]+|\*)$/.test(v) ? null : i18n()("settings.repoError"));
const teamError = (v: string) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? null : i18n()("settings.teamError"));
const userError = (v: string) => (/^[\w-]+(\[bot\])?$/.test(v) ? null : i18n()("settings.userError"));

const hours = (h: number, t: T) => (h === 0 ? t("settings.never") : h < 24 ? t("settings.hours", { count: h }) : t("settings.days", { count: h / 24 }));

export function QueueEditor({ queue, onChange }: { queue: Queue; onChange: (queue: Queue) => void }) {
  const set = <K extends keyof Queue>(key: K, value: Queue[K]) => onChange({ ...queue, [key]: value });
  const ids = { name: useId(), include: useId(), exclude: useId(), query: useId() };
  const events = KIND_EVENTS[queue.kind];
  const t = useT();

  return (
    <>
      <Group>
        <Row label={t("settings.name")} htmlFor={ids.name}>
          <Input id={ids.name} value={queue.name} maxLength={40} onChange={(e) => set("name", e.target.value)} className="w-56" />
        </Row>
        <Row label={t("settings.color")}>
          <div className="flex gap-2" role="radiogroup" aria-label={t("settings.color")} onKeyDown={radioKeys}>
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={queue.tone === tone}
                tabIndex={queue.tone === tone ? 0 : -1}
                aria-label={t(`settings.tone.${tone}`)}
                onClick={() => set("tone", tone)}
                // The picked colour ringed, as the accent colours in System Settings are; no change under the pointer.
                className={cn("size-4 cursor-default rounded-full outline-offset-2 focus-ring", TONE_FILL[tone], queue.tone === tone && "outline-2 outline-(--label-secondary)")}
              />
            ))}
          </div>
        </Row>
      </Group>

      <Group footer={queue.kind === "custom" ? t("settings.customFooter") : undefined}>
        <Row label={t("settings.pullRequestsWhere")} description={t("settings.pullRequestsWhereHint")}>
          <Select value={queue.kind} onValueChange={(v) => set("kind", v as QueueKind)}>
            <SelectTrigger className="min-w-64" aria-label={t("settings.pullRequestsWhere")}>
              <SelectValue>{(v: QueueKind) => t(`settings.kind.${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`settings.kind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {queue.kind === "review" ? (
          <>
            <SwitchRow checked={queue.hideOnceReviewed} onChange={(v) => set("hideOnceReviewed", v)} label={t("settings.hideOnceReviewed")} hint={t("settings.hideOnceReviewedHint")} />
            <SwitchRow checked={queue.directOnly} onChange={(v) => set("directOnly", v)} label={t("settings.directOnly")} hint={t("settings.directOnlyHint")} />
            {!queue.directOnly ? (
              <Row stacked label={t("settings.teamsMine")} description={t("settings.allMyTeams")}>
                <TagInput label={t("settings.teams")} value={queue.teams} onChange={(v) => set("teams", v)} placeholder="acme/web-platform" validate={teamError} />
              </Row>
            ) : null}
            <Row label={t("settings.stale")} description={t("settings.staleHint")}>
              <Select value={String(queue.staleHours)} onValueChange={(v) => set("staleHours", Number(v))}>
                <SelectTrigger className="min-w-32" aria-label={t("settings.staleLabel")}>
                  <SelectValue>{(v: string) => hours(Number(v), t)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[4, 8, 24, 48, 72, 0].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hours(h, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </>
        ) : null}
        {queue.kind === "involved" ? <SwitchRow checked={queue.onlyNews} onChange={(v) => set("onlyNews", v)} label={t("settings.onlyNews")} /> : null}
        {queue.kind === "merged" ? (
          <>
            <Row label={t("settings.inTheLast")}>
              <Select value={String(queue.mergedDays)} onValueChange={(v) => set("mergedDays", Number(v))}>
                <SelectTrigger className="min-w-28" aria-label={t("settings.daysLabel")}>
                  <SelectValue>{(v: string) => t("settings.days", { count: Number(v) })}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 7, 14, 30].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {t("settings.days", { count: d })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label={t("settings.skipIfI")} description={t("settings.skipIfIHint")}>
              <Select value={queue.skipIfI} onValueChange={(v) => set("skipIfI", v as Queue["skipIfI"])}>
                <SelectTrigger className="min-w-48" aria-label={t("settings.skipIfI")}>
                  <SelectValue>{(v: Queue["skipIfI"]) => t(`settings.skip.${v}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SKIPS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`settings.skip.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <SwitchRow
              checked={queue.requestedOnly}
              onChange={(v) => set("requestedOnly", v)}
              label={t("settings.requestedOnly")}
              hint={t("settings.requestedOnlyHint")}
            />
            {queue.requestedOnly ? (
              <>
                <SwitchRow checked={queue.directOnly} onChange={(v) => set("directOnly", v)} label={t("settings.directOnlyPast")} hint={t("settings.directOnlyPastHint")} />
                {!queue.directOnly ? (
                  <Row stacked label={t("settings.teamsAsks")} description={t("settings.allMyTeams")}>
                    <TagInput label={t("settings.teams")} value={queue.teams} onChange={(v) => set("teams", v)} placeholder="acme/web-platform" validate={teamError} />
                  </Row>
                ) : null}
              </>
            ) : null}
            <Row stacked label={t("settings.skipMergedBy")}>
              <TagInput label={t("settings.skipMergedByLabel")} value={queue.skipMergedBy} onChange={(v) => set("skipMergedBy", v)} placeholder={t("settings.usernamePlaceholder")} validate={userError} />
            </Row>
          </>
        ) : null}
        {queue.kind === "custom" ? (
          <Row stacked label={t("settings.githubSearch")} htmlFor={ids.query}>
            <Input id={ids.query} className="font-mono text-callout" spellCheck={false} value={queue.query} onChange={(e) => set("query", e.target.value)} placeholder="is:open team-review-requested:acme/web" />
          </Row>
        ) : null}
      </Group>

      <Group title={t("settings.inRepositories")} footer={t("settings.everyRepository")}>
        <Row stacked>
          <TagInput label={t("settings.repositories")} value={queue.repos} onChange={(v) => set("repos", v)} placeholder={t("settings.repoPlaceholder")} validate={repoError} />
        </Row>
      </Group>

      <Group title={t("settings.changingFiles")} footer={t("settings.changingFilesFooter")}>
        <Row stacked>
          <div className="flex flex-wrap gap-1.5">
            {PATH_PRESETS.map((preset) => (
              <Button
                key={preset.name}
                type="button"
                size="xs"
                variant="outline"
                className={PRESSED_CHIP}
                aria-pressed={queue.includePaths === preset.include && queue.excludePaths === preset.exclude}
                onClick={() => onChange({ ...queue, includePaths: preset.include, excludePaths: preset.exclude })}
              >
                {t(`settings.preset.${preset.name}`)}
              </Button>
            ))}
            {queue.includePaths || queue.excludePaths ? (
              <Button type="button" size="xs" variant="link" onClick={() => onChange({ ...queue, includePaths: "", excludePaths: "" })}>
                {t("settings.anyFile")}
              </Button>
            ) : null}
          </div>
        </Row>
        <Row label={t("settings.include")} htmlFor={ids.include}>
          <Input
            id={ids.include}
            className="w-80 font-mono text-callout"
            spellCheck={false}
            value={queue.includePaths}
            aria-invalid={!validPattern(queue.includePaths)}
            onChange={(e) => set("includePaths", e.target.value)}
            placeholder={t("settings.anyFilePlaceholder")}
          />
        </Row>
        <Row label={t("settings.exclude")} htmlFor={ids.exclude}>
          <Input
            id={ids.exclude}
            className="w-80 font-mono text-callout"
            spellCheck={false}
            value={queue.excludePaths}
            aria-invalid={!validPattern(queue.excludePaths)}
            onChange={(e) => set("excludePaths", e.target.value)}
            placeholder={t("settings.nothingPlaceholder")}
          />
        </Row>
        {!validPattern(queue.includePaths) || !validPattern(queue.excludePaths) ? (
          <Row>
            <p className="text-subheadline text-destructive" role="alert">
              {t("settings.invalidPattern")}
            </p>
          </Row>
        ) : null}
      </Group>

      <Group>
        <Row label={t("settings.drafts")}>
          <ToggleGroup value={[queue.drafts]} onValueChange={(v: string[]) => v[0] && set("drafts", v[0] as Queue["drafts"])} variant="outline" size="sm" aria-label={t("settings.drafts")}>
            <ToggleGroupItem value="show">{t("settings.drafts.show")}</ToggleGroupItem>
            <ToggleGroupItem value="hide">{t("settings.drafts.hide")}</ToggleGroupItem>
            <ToggleGroupItem value="only">{t("settings.drafts.only")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Group>

      <Group title={t("settings.leaveOut")}>
        <SwitchRow checked={queue.hideBots} onChange={(v) => set("hideBots", v)} label={t("settings.hideBots")} hint={t("settings.hideBotsHint")} />
        <Row stacked label={t("settings.openedBy")}>
          <TagInput label={t("settings.authorsLabel")} value={queue.excludeAuthors} onChange={(v) => set("excludeAuthors", v)} placeholder={t("settings.usernamePlaceholder")} validate={userError} />
        </Row>
        <Row stacked label={t("settings.approvedBy")}>
          <TagInput label={t("settings.approversLabel")} value={queue.skipApprovedBy} onChange={(v) => set("skipApprovedBy", v)} placeholder={t("settings.usernamePlaceholder")} validate={userError} />
        </Row>
        <Row stacked label={t("settings.onlyLabels")}>
          <TagInput label={t("settings.onlyLabelsLabel")} value={queue.includeLabels} onChange={(v) => set("includeLabels", v)} placeholder={t("settings.labelPlaceholder")} />
        </Row>
        <Row stacked label={t("settings.withoutLabels")}>
          <TagInput label={t("settings.withoutLabelsLabel")} value={queue.excludeLabels} onChange={(v) => set("excludeLabels", v)} placeholder={t("settings.labelPlaceholder")} />
        </Row>
      </Group>

      <Group title={t("settings.notifyWhen")} footer={t("settings.notifyWhenFooter")}>
        {events.map((kind) => (
          <SwitchRow
            key={kind}
            checked={queue.notify.includes(kind)}
            onChange={(on) => set("notify", on ? [...queue.notify, kind] : queue.notify.filter((k) => k !== kind))}
            label={t(`events.label.${kind}`)}
          />
        ))}
      </Group>

      {queue.notify.length ? (
        <>
          <Group footer={t("settings.notifyAtFooter")}>
            <Row label={t("settings.tellMe")}>
              <ToggleGroup value={[queue.notifyAt]} onValueChange={(v: string[]) => v[0] && set("notifyAt", v[0] as Queue["notifyAt"])} variant="outline" size="sm" aria-label={t("settings.whenToTellMe")}>
                <ToggleGroupItem value="now">{t("settings.rightAway")}</ToggleGroupItem>
                <ToggleGroupItem value="review">{t("settings.atReviewTime")}</ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </Group>
          <Group title={t("settings.leaveOutNotifications")} footer={t("settings.leaveOutNotificationsFooter")}>
            {LEAVE_OUT.map((kind) => (
              <SwitchRow
                key={kind}
                checked={queue.notifyLeaveOut.includes(kind)}
                onChange={(on) => set("notifyLeaveOut", on ? [...queue.notifyLeaveOut, kind] : queue.notifyLeaveOut.filter((k) => k !== kind))}
                label={t(`settings.leaveOut.${kind}`)}
                hint={LEAVE_OUT_HINTS[kind] ? t(LEAVE_OUT_HINTS[kind]) : undefined}
              />
            ))}
            <Row stacked label={t("settings.notifyRepos")} description={t("settings.notifyReposHint")}>
              <TagInput label={t("settings.notifyReposLabel")} value={queue.notifyRepos} onChange={(v) => set("notifyRepos", v)} placeholder={t("settings.repoPlaceholder")} validate={repoError} />
            </Row>
          </Group>
        </>
      ) : null}
    </>
  );
}
