// Review time: times set aside to review, like weekdays at 15:00 for half an hour. When one comes,
// Focus Diff picks the pull requests that fit, says so with a sound of its own and counts the time
// down in the menu bar. Rust runs them (src-tauri/src/review.rs); this edits them.

import { Plus, Timer, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { newSession, nextReviewTime, REVIEW_MINUTES, REVIEW_ORDERS, validTime, type Config, type Queue, type ReviewOrder, type ReviewSession, type ReviewTime } from "@/lib/config";
import { Group, Intro, LinkRow, Pane, PRESSED_CHIP, Row, SwitchRow, useDetail } from "./Form";
import { TagInput } from "./TagInput";

const ORDERS: Record<ReviewOrder, { label: string; hint: string }> = {
  oldest: { label: "Waiting longest", hint: "The oldest pull requests first, so nobody waits too long." },
  quickest: { label: "Quickest", hint: "As many as fit, the shortest first." },
  fill: { label: "Fill the time", hint: "The mix that uses the time best." },
};

/** The week from Monday, as most of the world starts it; 0 is Sunday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const dayName = (day: number, weekday: "short" | "long") => new Intl.DateTimeFormat(undefined, { weekday }).format(new Date(2024, 0, 7 + day));
const clock = (time: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2024, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))));
const list = (items: string[]) => new Intl.ListFormat(undefined, { type: "conjunction" }).format(items);

/** "Weekdays at 3:00 PM · 30 min", the way a review time reads in its row. */
function summary(session: ReviewSession) {
  if (!session.days.length) return "No days picked";
  const days = session.days.join();
  const when = days === "0,1,2,3,4,5,6" ? "Every day" : days === "1,2,3,4,5" ? "Weekdays" : days === "0,6" ? "Weekends" : list(WEEK.filter((d) => session.days.includes(d)).map((d) => dayName(d, "short")));
  const at = session.times.length ? `at ${list(session.times.map(clock))}` : "with no time yet";
  return `${when} ${at} · ${session.minutes} min`;
}

const timeError = (v: string) => (validTime(v) ? null : "A time like 15:00, on a 24-hour clock");

function SessionEditor({ session, queues, onChange }: { session: ReviewSession; queues: Queue[]; onChange: (session: ReviewSession) => void }) {
  const set = <K extends keyof ReviewSession>(key: K, value: ReviewSession[K]) => onChange({ ...session, [key]: value });
  const nameId = useId();
  const picked = (id: string) => session.queues.includes(id);
  return (
    <>
      <Group>
        <Row label="Name" htmlFor={nameId}>
          <Input id={nameId} value={session.name} maxLength={40} placeholder="Review time" onChange={(e) => set("name", e.target.value)} className="w-56" />
        </Row>
        <SwitchRow checked={session.on} onChange={(v) => set("on", v)} label="On" />
      </Group>

      <Group title="When" footer={session.times.length ? undefined : "Add at least one time."}>
        <Row label="Days">
          <ToggleGroup
            multiple
            value={session.days.map(String)}
            onValueChange={(v: string[]) => set("days", v.map(Number).sort((a, b) => a - b))}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Days"
          >
            {WEEK.map((day) => (
              <ToggleGroupItem key={day} value={String(day)} aria-label={dayName(day, "long")} className="px-2">
                {dayName(day, "short").slice(0, 2)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row stacked label="At" description="On a 24-hour clock, this computer's time.">
          <TagInput label="Times" value={session.times} onChange={(v) => set("times", [...v].sort())} placeholder="15:00" validate={timeError} />
        </Row>
        <Row label="For">
          <Select value={String(session.minutes)} onValueChange={(v) => set("minutes", Number(v))}>
            <SelectTrigger className="w-32" aria-label="How long">
              <SelectValue>{(v: string) => `${v} min`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...REVIEW_MINUTES, session.minutes])].sort((a, b) => a - b).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} min
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Group>

      <Group title="What to review" footer="Empty: every review queue. Each pull request is estimated at about 1,000 changed lines an hour, plus a couple of minutes to read it and write the review.">
        <Row label="What goes first" description={ORDERS[session.order].hint}>
          <Select value={session.order} onValueChange={(v) => set("order", v as ReviewOrder)}>
            <SelectTrigger className="w-40" aria-label="What goes first">
              <SelectValue>{(v: ReviewOrder) => ORDERS[v].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REVIEW_ORDERS.map((o) => (
                <SelectItem key={o} value={o}>
                  {ORDERS[o].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <SwitchRow checked={session.drafts} onChange={(v) => set("drafts", v)} label="Include drafts" />
        <Row stacked label="From these queues">
          <div className="flex flex-wrap gap-1.5">
            {queues.map((queue) => (
              <Button
                key={queue.id}
                type="button"
                size="xs"
                variant="outline"
                className={PRESSED_CHIP}
                aria-pressed={picked(queue.id)}
                onClick={() => set("queues", picked(queue.id) ? session.queues.filter((q) => q !== queue.id) : [...session.queues, queue.id])}
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

export function ReviewTimePane({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const review = config.reviewTime;
  const set = (patch: Partial<ReviewTime>) => onChange({ ...config, reviewTime: { ...review, ...patch } });
  const setSessions = (sessions: ReviewSession[]) => set({ sessions });
  const selected = review.sessions.find((s) => s.id === detail.openId) ?? null;
  const enabledId = useId();

  if (selected)
    return (
      <Pane
        title={selected.name || "Review time"}
        back={{ label: "Review time", onBack: detail.close, ref: detail.backRef }}
        tools={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${selected.name || "review time"}`}
            title="Delete review time"
            onClick={() => {
              setSessions(review.sessions.filter((s) => s.id !== selected.id));
              detail.close();
            }}
          >
            <Trash2 />
          </Button>
        }
      >
        <SessionEditor key={selected.id} session={selected} queues={config.queues.filter((q) => q.enabled)} onChange={(s) => setSessions(review.sessions.map((x) => (x.id === s.id ? s : x)))} />
      </Pane>
    );

  const next = nextReviewTime(review, new Date());
  const waiting = config.queues.filter((q) => q.enabled && q.notify.length && q.notifyAt === "review").map((q) => q.name);
  return (
    <Pane title="Review time">
      <Intro>Set aside time to review. When it comes, Focus Diff picks the pull requests that fit, by about how long each takes, tells you with a sound of its own, and counts the time down in the menu bar.</Intro>
      <Group
        footer={
          !review.enabled
            ? undefined
            : next
              ? `Next: ${dayName(next.at.getDay(), "long")} at ${clock(`${String(next.at.getHours()).padStart(2, "0")}:${String(next.at.getMinutes()).padStart(2, "0")}`)}, "${next.session.name || "Review time"}" for ${next.session.minutes} min.`
              : "No review time is on. Turn one on, or give it a day and a time."
        }
      >
        <Row label="Remind me when it's review time" htmlFor={enabledId}>
          <Switch id={enabledId} size="sm" checked={review.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        </Row>
      </Group>

      <Group
        title="Your review times"
        accessory={
          <Button
            variant="outline"
            size="xs"
            disabled={review.sessions.length >= 10}
            onClick={() => {
              const session = newSession();
              setSessions([...review.sessions, session]);
              detail.open(session.id);
            }}
          >
            <Plus /> Add Review Time
          </Button>
        }
      >
        {review.sessions.length ? (
          review.sessions.map((session) => (
            <LinkRow
              key={session.id}
              ref={detail.rowRef(session.id)}
              leading={
                <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-fill text-muted-foreground" aria-hidden>
                  <Timer className="size-3" strokeWidth={2.25} />
                </span>
              }
              label={session.name || "Review time"}
              description={summary(session)}
              muted={!session.on}
              onOpen={() => detail.open(session.id)}
              control={<Switch size="sm" checked={session.on} onCheckedChange={(on) => setSessions(review.sessions.map((s) => (s.id === session.id ? { ...s, on } : s)))} aria-label={`${session.name || "Review time"} on`} />}
            />
          ))
        ) : (
          <Row description="None yet. Add one, like weekdays at 15:00 for half an hour." />
        )}
      </Group>

      <Group
        title="When it's time"
        footer={`${waiting.length ? `Notifications from ${list(waiting)} wait for review time; change that in each queue.` : "Each queue's notifications can wait for review time; set that in the queue."} The sound plays when "Play a sound with notifications" is on, in General.`}
      >
        <SwitchRow checked={review.againFirst} onChange={(againFirst) => set({ againFirst })} label="Re-reviews first" hint="When someone asks you to review a pull request again, it goes before the rest, if it fits." />
        <SwitchRow checked={review.remindEnd} onChange={(remindEnd) => set({ remindEnd })} label="Tell me when the time's up" />
        <SwitchRow checked={review.skipEmpty} onChange={(skipEmpty) => set({ skipEmpty })} label="Say nothing when there's nothing to review" />
        <SwitchRow checked={review.holdWhileReviewing} onChange={(holdWhileReviewing) => set({ holdWhileReviewing })} label="Hold every notification while I review" hint="They show once the time's up." />
      </Group>
    </Pane>
  );
}
