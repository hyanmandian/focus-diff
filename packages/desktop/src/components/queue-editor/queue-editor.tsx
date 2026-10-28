// Editing one queue: what puts a pull request in it, where, what to leave out, and what's worth a
// notification. Every change applies right away (Settings saves it).

import { isValidPattern } from "@focus-diff/core/filters";
import { PATH_FILTERS } from "@focus-diff/core/recipes";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";
import { Group, PRESSED_CHIP, radioKeys, Row, SwitchRow, TONE_FILL } from "@/components/settings-form/settings-form";
import { TagInput } from "@/components/tag-input/tag-input";
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";
import { cn } from "@/utils/cn/cn";
import {
  canBe,
  KIND_EVENTS,
  LEAVE_OUT,
  PARTS,
  sourceOf,
  STATES,
  TONES,
  withSource,
  type LeaveOut,
  type Queue,
  type QueuePart,
} from "@/utils/config/config";
import { i18n, useT, type T } from "@/utils/i18n/i18n";

/** Path filters to start from, the same as Focus Diff's recipes; `name` keys their words (settings.preset.*). */
export const PATH_PRESETS = (["frontend", "backend", "code", "infra", "database", "docs"] as const).map((name) => ({
  name,
  ...PATH_FILTERS[name],
}));

/** What a queue's notifications can leave out that has a line under its name. */
const LEAVE_OUT_HINTS: Partial<Record<LeaveOut, "settings.leaveOut.bots.hint">> = {
  bots: "settings.leaveOut.bots.hint",
};

const SKIPS: Array<Queue["skipIfI"]> = ["approved", "reviewed", "tookPart"];
const DRAFTS: Array<Queue["drafts"]> = ["show", "hide", "only"];
const NOTIFY_AT: Array<Queue["notifyAt"]> = ["now", "review"];

/** Whether a value the controls hand back is one of a list's. */
const oneOf = <V extends string>(list: readonly V[], v: unknown): v is V => list.some((x) => x === v);

// Called as a value is added, so they read the words then.
const repoError = (v: string) => (/^[\w.-]+\/(?:[\w.-]+|\*)$/u.test(v) ? null : i18n()("settings.repoError"));
const teamError = (v: string) => (/^[\w.-]+\/[\w.-]+$/u.test(v) ? null : i18n()("settings.teamError"));
const userError = (v: string) => (/^[\w-]+(\[bot\])?$/u.test(v) ? null : i18n()("settings.userError"));

const hours = (h: number, t: T) =>
  h === 0 ? t("settings.never") : h < 24 ? t("settings.hours", { count: h }) : t("settings.days", { count: h / 24 });

export function QueueEditor({ queue, onChange }: { queue: Queue; onChange: (queue: Queue) => void }) {
  const set = <K extends keyof Queue>(key: K, value: Queue[K]) => {
    onChange({ ...queue, [key]: value });
  };
  const ids = { name: useId(), include: useId(), exclude: useId(), query: useId() };
  const events = KIND_EVENTS[queue.kind];
  const source = sourceOf(queue);
  const t = useT();

  const notifySwitches: ReactNode[] = [];
  for (const kind of events)
    notifySwitches.push(
      <SwitchRow
        key={kind}
        checked={queue.notify.includes(kind)}
        onChange={(on) => {
          set("notify", on ? [...queue.notify, kind] : queue.notify.filter((k) => k !== kind));
        }}
        label={t(`events.label.${kind}`)}
      />,
    );

  return (
    <>
      <Group>
        <Row label={t("settings.name")} htmlFor={ids.name}>
          <Input
            id={ids.name}
            value={queue.name}
            maxLength={40}
            onChange={(e) => {
              set("name", e.target.value);
            }}
            className="w-56"
          />
        </Row>
        <Row label={t("settings.color")}>
          {/* Roving focus: the picked swatch takes Tab and the arrows move between them (radioKeys), so
              the group itself needs no focus. */}
          {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- see above */}
          <div className="flex gap-2" role="radiogroup" aria-label={t("settings.color")} onKeyDown={radioKeys}>
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a colour swatch drawn on a button, with the roving focus above
                role="radio"
                aria-checked={queue.tone === tone}
                tabIndex={queue.tone === tone ? 0 : -1}
                aria-label={t(`settings.tone.${tone}`)}
                onClick={() => {
                  set("tone", tone);
                }}
                // The picked colour ringed, as the accent colours in System Settings are; a touch brighter under the pointer.
                className={cn(
                  "size-5 cursor-default rounded-full focus-ring outline-offset-2 transition-[filter] duration-(--duration-fast) hover:brightness-110",
                  TONE_FILL[tone],
                  queue.tone === tone && "outline-2 outline-(--label-secondary)",
                )}
              />
            ))}
          </div>
        </Row>
      </Group>

      <Group>
        {/* Two choices make any queue: which pull requests, and what you have to do with them. */}
        <Row label={t("settings.showState")}>
          <ToggleGroup
            value={[source.state]}
            onValueChange={(v: string[]) => {
              if (oneOf(STATES, v[0])) onChange(withSource(queue, v[0], source.part));
            }}
            variant="outline"
            size="sm"
            aria-label={t("settings.showState")}
          >
            <ToggleGroupItem value="open">{t("settings.state.open")}</ToggleGroupItem>
            <ToggleGroupItem value="merged">{t("settings.state.merged")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label={t("settings.myPart")} description={t("settings.myPartHint")}>
          <Select
            value={source.part}
            // Never null here: it's only for a select that can be left empty.
            onValueChange={(v) => {
              onChange(withSource(queue, source.state, v!));
            }}
          >
            <SelectTrigger className="min-w-64" aria-label={t("settings.myPart")}>
              <SelectValue>{(v: QueuePart) => t(`settings.part.${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PARTS.map((part) => (
                <SelectItem key={part} value={part} disabled={!canBe(source.state, part)}>
                  {t(`settings.part.${part}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {queue.kind === "review" ? (
          <>
            <SwitchRow
              checked={queue.hideOnceReviewed}
              onChange={(v) => {
                set("hideOnceReviewed", v);
              }}
              label={t("settings.hideOnceReviewed")}
              hint={t("settings.hideOnceReviewedHint")}
            />
            <SwitchRow
              checked={queue.directOnly}
              onChange={(v) => {
                set("directOnly", v);
              }}
              label={t("settings.directOnly")}
              hint={t("settings.directOnlyHint")}
            />
            {queue.directOnly ? null : (
              <Row stacked label={t("settings.teamsMine")} description={t("settings.allMyTeams")}>
                <TagInput
                  label={t("settings.teams")}
                  value={queue.teams}
                  onChange={(v) => {
                    set("teams", v);
                  }}
                  placeholder="acme/web-platform"
                  validate={teamError}
                />
              </Row>
            )}
            <Row label={t("settings.stale")} description={t("settings.staleHint")}>
              <Select
                value={String(queue.staleHours)}
                onValueChange={(v) => {
                  set("staleHours", Number(v));
                }}
              >
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
        {queue.kind === "involved" ? (
          <SwitchRow
            checked={queue.onlyNews}
            onChange={(v) => {
              set("onlyNews", v);
            }}
            label={t("settings.onlyNews")}
          />
        ) : null}
        {queue.kind === "merged" ? (
          <>
            <Row label={t("settings.inTheLast")}>
              <Select
                value={String(queue.mergedDays)}
                onValueChange={(v) => {
                  set("mergedDays", Number(v));
                }}
              >
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
              <Select
                value={queue.skipIfI}
                // Never null here, as above.
                onValueChange={(v) => {
                  set("skipIfI", v!);
                }}
              >
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
            {queue.requestedOnly ? (
              <>
                <SwitchRow
                  checked={queue.directOnly}
                  onChange={(v) => {
                    set("directOnly", v);
                  }}
                  label={t("settings.directOnlyPast")}
                  hint={t("settings.directOnlyPastHint")}
                />
                {queue.directOnly ? null : (
                  <Row stacked label={t("settings.teamsAsks")} description={t("settings.allMyTeams")}>
                    <TagInput
                      label={t("settings.teams")}
                      value={queue.teams}
                      onChange={(v) => {
                        set("teams", v);
                      }}
                      placeholder="acme/web-platform"
                      validate={teamError}
                    />
                  </Row>
                )}
              </>
            ) : null}
            <Row stacked label={t("settings.skipMergedBy")}>
              <TagInput
                label={t("settings.skipMergedByLabel")}
                value={queue.skipMergedBy}
                onChange={(v) => {
                  set("skipMergedBy", v);
                }}
                placeholder={t("settings.usernamePlaceholder")}
                validate={userError}
              />
            </Row>
          </>
        ) : null}
        {/* Anything else GitHub's search can say, on any queue: a label, a team, a word. */}
        <Row stacked label={t("settings.searchTerms")} description={t("settings.searchTermsHint")} htmlFor={ids.query}>
          <Input
            id={ids.query}
            className="font-mono text-callout"
            spellCheck={false}
            value={queue.query}
            onChange={(e) => {
              set("query", e.target.value);
            }}
            placeholder="team-review-requested:acme/web label:urgent"
          />
        </Row>
      </Group>

      <Group title={t("settings.inRepositories")} footer={t("settings.everyRepository")}>
        <Row stacked>
          <TagInput
            label={t("settings.repositories")}
            value={queue.repos}
            onChange={(v) => {
              set("repos", v);
            }}
            placeholder={t("settings.repoPlaceholder")}
            validate={repoError}
          />
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
                onClick={() => {
                  onChange({ ...queue, includePaths: preset.include, excludePaths: preset.exclude });
                }}
              >
                {t(`settings.preset.${preset.name}`)}
              </Button>
            ))}
            {queue.includePaths || queue.excludePaths ? (
              <Button
                type="button"
                size="xs"
                variant="link"
                onClick={() => {
                  onChange({ ...queue, includePaths: "", excludePaths: "" });
                }}
              >
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
            aria-invalid={!isValidPattern(queue.includePaths)}
            onChange={(e) => {
              set("includePaths", e.target.value);
            }}
            placeholder={t("settings.anyFilePlaceholder")}
          />
        </Row>
        <Row label={t("settings.exclude")} htmlFor={ids.exclude}>
          <Input
            id={ids.exclude}
            className="w-80 font-mono text-callout"
            spellCheck={false}
            value={queue.excludePaths}
            aria-invalid={!isValidPattern(queue.excludePaths)}
            onChange={(e) => {
              set("excludePaths", e.target.value);
            }}
            placeholder={t("settings.nothingPlaceholder")}
          />
        </Row>
        {!isValidPattern(queue.includePaths) || !isValidPattern(queue.excludePaths) ? (
          <Row>
            <p className="text-subheadline text-destructive" role="alert">
              {t("settings.invalidPattern")}
            </p>
          </Row>
        ) : null}
      </Group>

      <Group>
        <Row label={t("settings.drafts")}>
          <ToggleGroup
            value={[queue.drafts]}
            onValueChange={(v: string[]) => {
              if (oneOf(DRAFTS, v[0])) set("drafts", v[0]);
            }}
            variant="outline"
            size="sm"
            aria-label={t("settings.drafts")}
          >
            <ToggleGroupItem value="show">{t("settings.drafts.show")}</ToggleGroupItem>
            <ToggleGroupItem value="hide">{t("settings.drafts.hide")}</ToggleGroupItem>
            <ToggleGroupItem value="only">{t("settings.drafts.only")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Group>

      <Group title={t("settings.leaveOut")}>
        <SwitchRow
          checked={queue.hideBots}
          onChange={(v) => {
            set("hideBots", v);
          }}
          label={t("settings.hideBots")}
          hint={t("settings.hideBotsHint")}
        />
        <Row stacked label={t("settings.openedBy")}>
          <TagInput
            label={t("settings.authorsLabel")}
            value={queue.excludeAuthors}
            onChange={(v) => {
              set("excludeAuthors", v);
            }}
            placeholder={t("settings.usernamePlaceholder")}
            validate={userError}
          />
        </Row>
        <Row stacked label={t("settings.approvedBy")}>
          <TagInput
            label={t("settings.approversLabel")}
            value={queue.skipApprovedBy}
            onChange={(v) => {
              set("skipApprovedBy", v);
            }}
            placeholder={t("settings.usernamePlaceholder")}
            validate={userError}
          />
        </Row>
        <Row stacked label={t("settings.onlyLabels")}>
          <TagInput
            label={t("settings.onlyLabelsLabel")}
            value={queue.includeLabels}
            onChange={(v) => {
              set("includeLabels", v);
            }}
            placeholder={t("settings.labelPlaceholder")}
          />
        </Row>
        <Row stacked label={t("settings.withoutLabels")}>
          <TagInput
            label={t("settings.withoutLabelsLabel")}
            value={queue.excludeLabels}
            onChange={(v) => {
              set("excludeLabels", v);
            }}
            placeholder={t("settings.labelPlaceholder")}
          />
        </Row>
      </Group>

      <Group title={t("settings.notifyWhen")} footer={t("settings.notifyWhenFooter")}>
        {notifySwitches}
      </Group>

      {queue.notify.length > 0 ? (
        <>
          <Group footer={t("settings.notifyAtFooter")}>
            <Row label={t("settings.tellMe")}>
              <ToggleGroup
                value={[queue.notifyAt]}
                onValueChange={(v: string[]) => {
                  if (oneOf(NOTIFY_AT, v[0])) set("notifyAt", v[0]);
                }}
                variant="outline"
                size="sm"
                aria-label={t("settings.whenToTellMe")}
              >
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
                onChange={(on) => {
                  set(
                    "notifyLeaveOut",
                    on ? [...queue.notifyLeaveOut, kind] : queue.notifyLeaveOut.filter((k) => k !== kind),
                  );
                }}
                label={t(`settings.leaveOut.${kind}`)}
                hint={LEAVE_OUT_HINTS[kind] ? t(LEAVE_OUT_HINTS[kind]) : undefined}
              />
            ))}
            <Row stacked label={t("settings.notifyRepos")} description={t("settings.notifyReposHint")}>
              <TagInput
                label={t("settings.notifyReposLabel")}
                value={queue.notifyRepos}
                onChange={(v) => {
                  set("notifyRepos", v);
                }}
                placeholder={t("settings.repoPlaceholder")}
                validate={repoError}
              />
            </Row>
          </Group>
        </>
      ) : null}
    </>
  );
}

/** A queue in a line, from how it's set up, for its row in the list: where its pull requests come
 *  from, then what narrows them. Made from the settings, so it fits any queue. */
export function queueSummary(queue: Queue, t: T): string {
  const source = sourceOf(queue);
  const parts = [t(`settings.summary.${source.state}.${source.part}`)];
  if (queue.query.trim()) parts.push(queue.query.trim());
  if (queue.repos.length > 0)
    parts.push(queue.repos.length === 1 ? queue.repos[0]! : t("settings.summaryRepos", { count: queue.repos.length }));
  if (queue.includePaths || queue.excludePaths) {
    const preset = PATH_PRESETS.find((p) => p.include === queue.includePaths && p.exclude === queue.excludePaths);
    parts.push(preset ? t(`settings.preset.${preset.name}`) : t("settings.summaryFiles"));
  }
  if (queue.includeLabels.length > 0) parts.push(queue.includeLabels.join(", "));
  return parts.join(" · ");
}
