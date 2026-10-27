// Review time: times set aside to review, like weekdays at 15:00 for half an hour. When one comes,
// Focus Diff picks the pull requests that fit, says so with a sound of its own and counts the time
// down in the menu bar. Rust runs them (src-tauri/src/review.rs); this edits them.

import { LINES_PER_HOUR } from "@focus-diff/core/estimate";
import { Plus, Timer, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";
import {
  Group,
  Intro,
  LinkRow,
  Pane,
  PRESSED_CHIP,
  Row,
  SwitchRow,
  useDetail,
} from "@/components/settings-form/settings-form";
import { Switch } from "@/components/switch/switch";
import { TagInput } from "@/components/tag-input/tag-input";
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";
import {
  newSession,
  nextReviewTime,
  REVIEW_MINUTES,
  REVIEW_ORDERS,
  validTime,
  type Config,
  type Queue,
  type ReviewOrder,
  type ReviewSession,
  type ReviewTime,
} from "@/utils/config/config";
import { confirmRemove } from "@/utils/confirm/confirm";
import { i18n, useT, type T } from "@/utils/i18n/i18n";

/** The week from Monday, as most of the world starts it; 0 is Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** "15:00" as the person's clock shows it, in the app's language. */
const clock = (time: string, t: T) => t.clock(new Date(2024, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))));

/** "Weekdays at 3:00 PM · 30 min", the way a review time reads in its row. */
function summary(session: ReviewSession, t: T) {
  if (session.days.length === 0) return t("settings.noDays");
  const picked = session.days.join();
  const days =
    picked === "0,1,2,3,4,5,6"
      ? t("settings.everyDay")
      : picked === "1,2,3,4,5"
        ? t("settings.weekdays")
        : picked === "0,6"
          ? t("settings.weekends")
          : t.list(WEEK.filter((d) => session.days.includes(d)).map((d) => t.weekday(d, "short")));
  return session.times.length > 0
    ? t("settings.summaryAt", {
        days,
        times: t.list(session.times.map((time) => clock(time, t))),
        minutes: session.minutes,
      })
    : t("settings.summaryNoTime", { days, minutes: session.minutes });
}

/** A day on its toggle: two letters in English ("Mo"); Portuguese needs three to tell segunda from
 *  sexta and quarta from quinta ("seg", "sex"), without the abbreviation's period. */
const dayInitials = (day: number, t: T) =>
  t.locale === "en" ? t.weekday(day, "short").slice(0, 2) : t.weekday(day, "short").replace(/\.$/u, "");

// Called as a time is added, so it reads the words then.
const timeError = (v: string) => (validTime(v) ? null : i18n()("settings.timeError"));

function SessionEditor({
  session,
  queues,
  onChange,
}: {
  session: ReviewSession;
  queues: Queue[];
  onChange: (session: ReviewSession) => void;
}) {
  const set = <K extends keyof ReviewSession>(key: K, value: ReviewSession[K]) => {
    onChange({ ...session, [key]: value });
  };
  const nameId = useId();
  const picked = (id: string) => session.queues.includes(id);
  const t = useT();
  return (
    <>
      <Group>
        <Row label={t("settings.name")} htmlFor={nameId}>
          <Input
            id={nameId}
            value={session.name}
            maxLength={40}
            placeholder={t("settings.reviewTimeName")}
            onChange={(e) => {
              set("name", e.target.value);
            }}
            className="w-56"
          />
        </Row>
        <SwitchRow
          checked={session.on}
          onChange={(v) => {
            set("on", v);
          }}
          label={t("settings.on")}
        />
      </Group>

      <Group title={t("settings.when")} footer={session.times.length > 0 ? undefined : t("settings.addTime")}>
        <Row label={t("settings.daysLabel")}>
          <ToggleGroup
            multiple
            value={session.days.map(String)}
            onValueChange={(v: string[]) => {
              set(
                "days",
                v.map(Number).toSorted((a, b) => a - b),
              );
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label={t("settings.daysLabel")}
          >
            {WEEK.map((day) => (
              <ToggleGroupItem key={day} value={String(day)} aria-label={t.weekday(day, "long")} className="px-2">
                {dayInitials(day, t)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row stacked label={t("settings.at")} description={t("settings.atHint")}>
          <TagInput
            label={t("settings.times")}
            value={session.times}
            onChange={(v) => {
              set("times", v.toSorted());
            }}
            placeholder="15:00"
            validate={timeError}
          />
        </Row>
        <Row label={t("settings.for")}>
          <Select
            value={String(session.minutes)}
            onValueChange={(v) => {
              set("minutes", Number(v));
            }}
          >
            <SelectTrigger className="min-w-32" aria-label={t("settings.howLong")}>
              <SelectValue>{(v: string) => t("settings.minutes", { minutes: Number(v) })}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...REVIEW_MINUTES, session.minutes])]
                .toSorted((a, b) => a - b)
                .map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("settings.minutes", { minutes: m })}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>

      <Group title={t("settings.whatToReview")} footer={t("settings.whatToReviewFooter", { lines: LINES_PER_HOUR })}>
        <Row label={t("settings.whatGoesFirst")} description={t(`settings.order.${session.order}.hint`)}>
          <Select<ReviewOrder>
            value={session.order}
            onValueChange={(v) => {
              // Never null: there's no empty choice in the list.
              set("order", v!);
            }}
          >
            <SelectTrigger className="min-w-40" aria-label={t("settings.whatGoesFirst")}>
              <SelectValue>{(v: ReviewOrder) => t(`settings.order.${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REVIEW_ORDERS.map((o) => (
                <SelectItem key={o} value={o}>
                  {t(`settings.order.${o}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <SwitchRow
          checked={session.drafts}
          onChange={(v) => {
            set("drafts", v);
          }}
          label={t("settings.includeDrafts")}
        />
        <Row stacked label={t("settings.fromQueues")}>
          <div className="flex flex-wrap gap-1.5">
            {queues.map((queue) => (
              <Button
                key={queue.id}
                type="button"
                size="xs"
                variant="outline"
                className={PRESSED_CHIP}
                aria-pressed={picked(queue.id)}
                onClick={() => {
                  set(
                    "queues",
                    picked(queue.id) ? session.queues.filter((q) => q !== queue.id) : [...session.queues, queue.id],
                  );
                }}
              >
                {queue.name}
              </Button>
            ))}
          </div>
        </Row>
      </Group>
    </>
  );
}

/** The next review time, as of now. */
const nextFromNow = (review: ReviewTime) => nextReviewTime(review, new Date());

export function ReviewTimePane({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const review = config.reviewTime;
  const set = (patch: Partial<ReviewTime>) => {
    onChange({ ...config, reviewTime: { ...review, ...patch } });
  };
  const setSessions = (sessions: ReviewSession[]) => {
    set({ sessions });
  };
  const selected = review.sessions.find((s) => s.id === detail.openId) ?? null;
  const enabledId = useId();
  const t = useT();
  const reviewTimeName = t("settings.reviewTimeName");
  const remove = async (session: ReviewSession) => {
    if (!(await confirmRemove(t("settings.removeReviewTimeConfirm", { name: session.name || reviewTimeName })))) return;
    setSessions(review.sessions.filter((s) => s.id !== session.id));
    detail.close();
  };

  if (selected)
    return (
      <Pane
        title={selected.name || reviewTimeName}
        back={{ label: t("settings.pane.review"), onBack: detail.close, ref: detail.backRef }}
        tools={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("settings.deleteNamed", { name: selected.name || reviewTimeName })}
            title={t("settings.deleteReviewTime")}
            onClick={() => {
              void remove(selected);
            }}
          >
            <Trash2 />
          </Button>
        }
      >
        <SessionEditor
          key={selected.id}
          session={selected}
          queues={config.queues.filter((q) => q.enabled)}
          onChange={(s) => {
            setSessions(review.sessions.map((x) => (x.id === s.id ? s : x)));
          }}
        />
      </Pane>
    );

  const next = nextFromNow(review);
  const waiting = config.queues
    .filter((q) => q.enabled && q.notify.length > 0 && q.notifyAt === "review")
    .map((q) => q.name);
  return (
    <Pane title={t("settings.pane.review")} hero="review">
      <Intro>{t("settings.reviewIntro")}</Intro>
      <Group
        footer={
          review.enabled
            ? next
              ? t("settings.next", {
                  day: t.weekday(next.at.getDay(), "long"),
                  time: t.clock(next.at),
                  name: next.session.name || reviewTimeName,
                  minutes: next.session.minutes,
                })
              : t("settings.noneOn")
            : undefined
        }
      >
        <Row label={t("settings.remindMe")} htmlFor={enabledId}>
          <Switch
            id={enabledId}
            size="sm"
            checked={review.enabled}
            onCheckedChange={(enabled) => {
              set({ enabled });
            }}
          />
        </Row>
      </Group>

      <Group
        title={t("settings.yourReviewTimes")}
        accessory={
          <Button
            variant="outline"
            disabled={review.sessions.length >= 10}
            onClick={() => {
              const session = newSession();
              setSessions([...review.sessions, session]);
              detail.open(session.id);
            }}
          >
            <Plus /> {t("settings.addReviewTime")}
          </Button>
        }
      >
        {review.sessions.length > 0 ? (
          review.sessions.map((session) => (
            <LinkRow
              key={session.id}
              ref={detail.rowRef(session.id)}
              leading={
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-fill text-muted-foreground"
                  aria-hidden
                >
                  <Timer className="size-3" strokeWidth={2.25} />
                </span>
              }
              label={session.name || reviewTimeName}
              description={summary(session, t)}
              muted={!session.on}
              onOpen={() => {
                detail.open(session.id);
              }}
              control={
                <Switch
                  size="sm"
                  checked={session.on}
                  onCheckedChange={(on) => {
                    setSessions(review.sessions.map((s) => (s.id === session.id ? { ...s, on } : s)));
                  }}
                  aria-label={t("settings.sessionOn", { name: session.name || reviewTimeName })}
                />
              }
            />
          ))
        ) : (
          <Row description={t("settings.noSessions")} />
        )}
      </Group>

      <Group
        title={t("settings.whenItsTime")}
        footer={
          waiting.length > 0 ? t("settings.waitingQueues", { queues: t.list(waiting) }) : t("settings.noWaitingQueues")
        }
      >
        <SwitchRow
          checked={review.againFirst}
          onChange={(againFirst) => {
            set({ againFirst });
          }}
          label={t("settings.againFirst")}
          hint={t("settings.againFirstHint")}
        />
        <SwitchRow
          checked={review.remindEnd}
          onChange={(remindEnd) => {
            set({ remindEnd });
          }}
          label={t("settings.remindEnd")}
        />
        <SwitchRow
          checked={review.skipEmpty}
          onChange={(skipEmpty) => {
            set({ skipEmpty });
          }}
          label={t("settings.skipEmpty")}
        />
        <SwitchRow
          checked={review.holdWhileReviewing}
          onChange={(holdWhileReviewing) => {
            set({ holdWhileReviewing });
          }}
          label={t("settings.hold")}
          hint={t("settings.holdHint")}
        />
      </Group>
    </Pane>
  );
}
