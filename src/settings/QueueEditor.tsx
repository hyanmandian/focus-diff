// Editing one queue: what puts a pull request in it, where, what to leave out, and what's worth a
// notification. Every change applies right away (Settings saves it).

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TONES, validPattern, type EventKind, type Queue, type QueueKind } from "@/lib/config";
import { EVENT_LABELS } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { Group, Row } from "./Form";
import { TagInput } from "./TagInput";

/** Path filters to start from, the same as Focus Diff's recipes. */
const PATH_PRESETS: Array<{ name: string; include: string; exclude: string }> = [
  { name: "Frontend", include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: "\\.(test|spec|stories)\\." },
  { name: "Backend", include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\." },
  { name: "Code, no tests", include: "", exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/" },
  { name: "Infrastructure", include: "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$", exclude: "" },
  { name: "Database", include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" },
  { name: "Docs", include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" },
];

const KIND_LABELS: Record<QueueKind, string> = {
  review: "My review is requested",
  involved: "I reviewed, commented or was mentioned",
  authored: "I opened them",
  merged: "They were merged",
  custom: "They match a GitHub search",
};

/** The events that can happen to the pull requests of each kind of queue. */
const KIND_EVENTS: Record<QueueKind, EventKind[]> = {
  review: ["new", "rerequest"],
  involved: ["new", "commits", "reply", "mention", "comment", "rerequest"],
  authored: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"],
  merged: ["new"],
  custom: ["new", "commits", "reply", "mention", "comment", "rerequest"],
};

const TONE_CLASS: Record<Queue["tone"], string> = {
  blue: "bg-unread",
  purple: "bg-violet",
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  gray: "bg-muted-foreground",
};

const SKIP_LABELS: Record<Queue["skipIfI"], string> = {
  approved: "approved",
  reviewed: "reviewed in any way",
  tookPart: "took any part in",
};

const repoError = (v: string) => (/^[\w.-]+\/(?:[\w.-]+|\*)$/.test(v) ? null : "Use owner/name, or owner/* for all of an owner's repositories");
const teamError = (v: string) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? null : "Use organization/team, as in GitHub's @org/team");
const userError = (v: string) => (/^[\w-]+(\[bot\])?$/.test(v) ? null : "A GitHub username");

function SwitchRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <Row label={label} description={hint} htmlFor={id}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

const hours = (h: number) => (h === 0 ? "Never" : h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`);

export function QueueEditor({ queue, onChange }: { queue: Queue; onChange: (queue: Queue) => void }) {
  const set = <K extends keyof Queue>(key: K, value: Queue[K]) => onChange({ ...queue, [key]: value });
  const ids = { name: useId(), include: useId(), exclude: useId(), query: useId() };
  const events = KIND_EVENTS[queue.kind];

  return (
    <>
      <Group>
        <Row label="Name" htmlFor={ids.name}>
          <Input id={ids.name} value={queue.name} maxLength={40} onChange={(e) => set("name", e.target.value)} className="h-7 w-56 text-[13px]" />
        </Row>
        <Row label="Color">
          <div className="flex gap-2" role="radiogroup" aria-label="Color">
            {TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={queue.tone === tone}
                aria-label={tone}
                onClick={() => set("tone", tone)}
                className={cn(
                  "size-4 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring motion-safe:transition-transform motion-safe:hover:scale-110",
                  TONE_CLASS[tone],
                  queue.tone === tone && "outline-2 outline-foreground",
                )}
              />
            ))}
          </div>
        </Row>
      </Group>

      <Group footer={queue.kind === "custom" ? "GitHub's search qualifiers, as on github.com/pulls. Pull requests only; the filters below still apply." : undefined}>
        <Row label="Pull requests where" description="What puts a pull request in this queue.">
          <Select value={queue.kind} onValueChange={(v) => set("kind", v as QueueKind)}>
            <SelectTrigger size="sm" className="w-64" aria-label="Pull requests where">
              <SelectValue>{(v: QueueKind) => KIND_LABELS[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABELS) as QueueKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {queue.kind === "review" ? (
          <>
            <SwitchRow checked={queue.hideOnceReviewed} onChange={(v) => set("hideOnceReviewed", v)} label="Leave once I've reviewed or commented" hint="It moves on to a queue of updates, if you have one." />
            <SwitchRow checked={queue.directOnly} onChange={(v) => set("directOnly", v)} label="Only when I'm asked directly" hint="Not when one of my teams is." />
            {!queue.directOnly ? (
              <Row stacked label="Count requests to these teams as mine" description="Empty: all my teams.">
                <TagInput label="Teams" value={queue.teams} onChange={(v) => set("teams", v)} placeholder="acme/web-platform" validate={teamError} />
              </Row>
            ) : null}
            <Row label="Call out pull requests waiting on me for" description="Counted from when you (or your team) were last asked.">
              <Select value={String(queue.staleHours)} onValueChange={(v) => set("staleHours", Number(v))}>
                <SelectTrigger size="sm" className="w-32" aria-label="Waiting long after">
                  <SelectValue>{(v: string) => hours(Number(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[4, 8, 24, 48, 72, 0].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hours(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </>
        ) : null}
        {queue.kind === "involved" ? <SwitchRow checked={queue.onlyNews} onChange={(v) => set("onlyNews", v)} label="Only with something new since my last word" /> : null}
        {queue.kind === "merged" ? (
          <>
            <Row label="In the last">
              <Select value={String(queue.mergedDays)} onValueChange={(v) => set("mergedDays", Number(v))}>
                <SelectTrigger size="sm" className="w-28" aria-label="Days">
                  <SelectValue>{(v: string) => `${v} ${v === "1" ? "day" : "days"}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 7, 14, 30].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} {d === 1 ? "day" : "days"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Leave out those I" description="And those you took yourself off the review of.">
              <Select value={queue.skipIfI} onValueChange={(v) => set("skipIfI", v as Queue["skipIfI"])}>
                <SelectTrigger size="sm" className="w-48" aria-label="Leave out those I">
                  <SelectValue>{(v: Queue["skipIfI"]) => SKIP_LABELS[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SKIP_LABELS) as Array<Queue["skipIfI"]>).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SKIP_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <SwitchRow
              checked={queue.requestedOnly}
              onChange={(v) => set("requestedOnly", v)}
              label="Only those my review was asked on"
              hint="Asked of you or of one of your teams, even if someone else reviewed first."
            />
            {queue.requestedOnly ? (
              <>
                <SwitchRow checked={queue.directOnly} onChange={(v) => set("directOnly", v)} label="Only when I was asked directly" hint="Not when one of my teams was." />
                {!queue.directOnly ? (
                  <Row stacked label="Count asks to these teams" description="Empty: all my teams.">
                    <TagInput label="Teams" value={queue.teams} onChange={(v) => set("teams", v)} placeholder="acme/web-platform" validate={teamError} />
                  </Row>
                ) : null}
              </>
            ) : null}
            <Row stacked label="Leave out those merged by">
              <TagInput label="Mergers to leave out" value={queue.skipMergedBy} onChange={(v) => set("skipMergedBy", v)} placeholder="username" validate={userError} />
            </Row>
          </>
        ) : null}
        {queue.kind === "custom" ? (
          <Row stacked label="GitHub search" htmlFor={ids.query}>
            <Input id={ids.query} className="h-7 font-mono text-xs" spellCheck={false} value={queue.query} onChange={(e) => set("query", e.target.value)} placeholder="is:open team-review-requested:acme/web" />
          </Row>
        ) : null}
      </Group>

      <Group title="In repositories" footer="Empty: every repository you can see.">
        <Row stacked>
          <TagInput label="Repositories" value={queue.repos} onChange={(v) => set("repos", v)} placeholder="acme/web or acme/*" validate={repoError} />
        </Row>
      </Group>

      <Group title="Changing files" footer="Regular expressions on file paths, like Focus Diff's filters.">
        <Row stacked>
          <div className="flex flex-wrap gap-1.5">
            {PATH_PRESETS.map((preset) => (
              <Button
                key={preset.name}
                type="button"
                size="xs"
                variant={queue.includePaths === preset.include && queue.excludePaths === preset.exclude ? "secondary" : "outline"}
                aria-pressed={queue.includePaths === preset.include && queue.excludePaths === preset.exclude}
                onClick={() => onChange({ ...queue, includePaths: preset.include, excludePaths: preset.exclude })}
              >
                {preset.name}
              </Button>
            ))}
            {queue.includePaths || queue.excludePaths ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ ...queue, includePaths: "", excludePaths: "" })}>
                Any file
              </Button>
            ) : null}
          </div>
        </Row>
        <Row label="Include" htmlFor={ids.include}>
          <Input
            id={ids.include}
            className="h-7 w-80 font-mono text-xs"
            spellCheck={false}
            value={queue.includePaths}
            aria-invalid={!validPattern(queue.includePaths)}
            onChange={(e) => set("includePaths", e.target.value)}
            placeholder="any file"
          />
        </Row>
        <Row label="Exclude" htmlFor={ids.exclude}>
          <Input
            id={ids.exclude}
            className="h-7 w-80 font-mono text-xs"
            spellCheck={false}
            value={queue.excludePaths}
            aria-invalid={!validPattern(queue.excludePaths)}
            onChange={(e) => set("excludePaths", e.target.value)}
            placeholder="nothing"
          />
        </Row>
        {!validPattern(queue.includePaths) || !validPattern(queue.excludePaths) ? (
          <Row>
            <p className="text-[11px] text-destructive" role="alert">
              That isn't a valid regular expression yet; it's ignored until it is.
            </p>
          </Row>
        ) : null}
      </Group>

      <Group>
        <Row label="Drafts">
          <ToggleGroup value={[queue.drafts]} onValueChange={(v: string[]) => v[0] && set("drafts", v[0] as Queue["drafts"])} variant="outline" size="sm" aria-label="Drafts">
            <ToggleGroupItem value="show">Show</ToggleGroupItem>
            <ToggleGroupItem value="hide">Hide</ToggleGroupItem>
            <ToggleGroupItem value="only">Only drafts</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Group>

      <Group title="Leave out">
        <SwitchRow checked={queue.hideBots} onChange={(v) => set("hideBots", v)} label="Pull requests opened by bots" hint="Dependabot, Renovate and the like." />
        <Row stacked label="Opened by">
          <TagInput label="Authors to leave out" value={queue.excludeAuthors} onChange={(v) => set("excludeAuthors", v)} placeholder="username" validate={userError} />
        </Row>
        <Row stacked label="Approved by">
          <TagInput label="Approvers to leave out" value={queue.skipApprovedBy} onChange={(v) => set("skipApprovedBy", v)} placeholder="username" validate={userError} />
        </Row>
        <Row stacked label="Only with labels">
          <TagInput label="Labels to require" value={queue.includeLabels} onChange={(v) => set("includeLabels", v)} placeholder="label" />
        </Row>
        <Row stacked label="Without labels">
          <TagInput label="Labels to leave out" value={queue.excludeLabels} onChange={(v) => set("excludeLabels", v)} placeholder="label" />
        </Row>
      </Group>

      <Group title="Notify me when" footer="Cards still show everything that's new.">
        {events.map((kind) => (
          <SwitchRow
            key={kind}
            checked={queue.notify.includes(kind)}
            onChange={(on) => set("notify", on ? [...queue.notify, kind] : queue.notify.filter((k) => k !== kind))}
            label={EVENT_LABELS[kind]}
          />
        ))}
      </Group>
    </>
  );
}
