// The person's own buttons on pull requests: each runs its steps in order, from the panel and the
// review window. Commands ask for permission the first time they run (in Rust, not here).

import { ArrowDown, ArrowUp, Plus, Trash2, X, Zap } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { STEP_LABELS } from "@/lib/actions";
import { ACTION_TEMPLATES, STEP_KINDS, type Action, type ActionStep, type Config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Group, Page, Row, SideList, sideItem } from "./Form";
import { TagInput } from "./TagInput";

const STEP_HINTS: Record<ActionStep["kind"], string> = {
  comment: "Posts a comment on the pull request, as you.",
  request: "Asks these people or teams to review.",
  unrequestMe: "Removes your own review request.",
  label: "Adds labels to the pull request.",
  open: "Opens a link in your browser.",
  run: "Runs a shell command on this computer, as you.",
};

const newStep = (kind: ActionStep["kind"]): ActionStep => {
  switch (kind) {
    case "comment":
      return { kind, body: "" };
    case "request":
      return { kind, reviewers: [] };
    case "unrequestMe":
      return { kind };
    case "label":
      return { kind, labels: [] };
    case "open":
      return { kind, url: "https://" };
    case "run":
      return { kind, command: "" };
  }
};

const reviewerError = (v: string) => (/^[\w-]+(\/[\w.-]+)?$/.test(v) ? null : "A username, or organization/team");
const PLACEHOLDERS = "{number} {title} {url} {repo} {author} {me}";

function StepEditor({ step, onChange }: { step: ActionStep; onChange: (step: ActionStep) => void }) {
  const id = useId();
  switch (step.kind) {
    case "comment":
      return (
        <div className="flex flex-col gap-1">
          <Textarea aria-label="Comment" rows={3} className="text-[13px]" value={step.body} onChange={(e) => onChange({ ...step, body: e.target.value })} placeholder="@dana could you take this one?" />
          <p className="text-[11px] text-muted-foreground">Markdown. Fills in {PLACEHOLDERS}.</p>
        </div>
      );
    case "request":
      return <TagInput label="Reviewers" value={step.reviewers} onChange={(reviewers) => onChange({ ...step, reviewers })} placeholder="username or org/team" validate={reviewerError} />;
    case "unrequestMe":
      return null;
    case "label":
      return <TagInput label="Labels" value={step.labels} onChange={(labels) => onChange({ ...step, labels })} placeholder="label" />;
    case "open":
      return (
        <div className="flex flex-col gap-1">
          <Input aria-label="Link" className="font-mono text-xs" spellCheck={false} value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">An https link. Fills in {PLACEHOLDERS}.</p>
        </div>
      );
    case "run":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="sr-only">
            Command
          </Label>
          <Textarea
            id={id}
            rows={3}
            className="font-mono text-xs"
            spellCheck={false}
            value={step.command}
            onChange={(e) => onChange({ ...step, command: e.target.value })}
            placeholder={'curl -s -X POST "$SLACK_WEBHOOK" -d "{\\"text\\": \\"Review please: $PR_URL\\"}"'}
          />
          <p className="text-[11px] text-muted-foreground">
            Runs with <code className="font-mono">sh</code> in your home folder, for up to two minutes. Gets <code className="font-mono">$PR_NUMBER $PR_TITLE $PR_URL $PR_REPO $PR_AUTHOR $GITHUB_LOGIN</code>. Its last line of output is shown. The first time a command runs, or after it changes, you're asked to allow it.
          </p>
        </div>
      );
  }
}

function ActionEditor({ action, onChange }: { action: Action; onChange: (action: Action) => void }) {
  const nameId = useId();
  const setStep = (index: number, step: ActionStep | null) => {
    const steps = [...action.steps];
    if (step) steps[index] = step;
    else steps.splice(index, 1);
    onChange({ ...action, steps });
  };
  const move = (index: number, by: number) => {
    const steps = [...action.steps];
    const [step] = steps.splice(index, 1);
    if (step) steps.splice(index + by, 0, step);
    onChange({ ...action, steps });
  };

  return (
    <>
      <Group>
        <Row label="Button" htmlFor={nameId}>
          <Input id={nameId} value={action.name} maxLength={30} onChange={(e) => onChange({ ...action, name: e.target.value })} className="h-7 w-56 text-[13px]" />
        </Row>
        <Row label="Ask me to confirm" description="Before running." htmlFor={`${nameId}-confirm`}>
          <Switch id={`${nameId}-confirm`} checked={action.confirm} onCheckedChange={(confirm) => onChange({ ...action, confirm })} />
        </Row>
      </Group>

      <Group title="Steps" footer="In order. If one fails, the rest don't run.">
        {action.steps.length ? (
          <ol className="contents">
            {action.steps.map((step, i) => (
              <li key={i} className="flex flex-col gap-2 px-2.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/[0.08] text-[11px] font-medium tabular-nums">{i + 1}</span>
                  <span className="shrink-0 text-[13px]">{STEP_LABELS[step.kind]}</span>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{STEP_HINTS[step.kind]}</span>
                  <div className="ml-auto flex shrink-0">
                    <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === action.steps.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Remove step ${i + 1}`} onClick={() => setStep(i, null)}>
                      <X />
                    </Button>
                  </div>
                </div>
                <StepEditor step={step} onChange={(next) => setStep(i, next)} />
              </li>
            ))}
          </ol>
        ) : null}
        <div className="px-1.5 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="text-[12px] font-normal" disabled={action.steps.length >= 10} />}>
              <Plus /> Add step
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {STEP_KINDS.map((kind) => (
                <DropdownMenuItem key={kind} className="flex-col items-start gap-0.5 whitespace-normal" onClick={() => onChange({ ...action, steps: [...action.steps, newStep(kind)] })}>
                  <span className="font-medium">{STEP_LABELS[kind]}</span>
                  <span className="text-[11px] text-muted-foreground">{STEP_HINTS[kind]}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Group>
    </>
  );
}

export function Actions({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const [selectedId, setSelectedId] = useState(config.actions[0]?.id ?? null);
  const selected = config.actions.find((a) => a.id === selectedId) ?? config.actions[0] ?? null;
  const setActions = (actions: Action[]) => onChange({ ...config, actions });

  return (
    <div className="grid h-full grid-cols-[208px_1fr]">
      <SideList
        label="Actions"
        footer={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="text-[12px] font-normal" disabled={config.actions.length >= 12} />}>
              <Plus /> Add action
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {ACTION_TEMPLATES.map((template) => (
                <DropdownMenuItem
                  key={template.name}
                  className="flex-col items-start gap-0.5 whitespace-normal"
                  onClick={() => {
                    const action = template.make();
                    setActions([...config.actions, action]);
                    setSelectedId(action.id);
                  }}
                >
                  <span className="font-medium">{template.name}</span>
                  <span className="text-[11px] text-muted-foreground">{template.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {config.actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => setSelectedId(action.id)}
              aria-current={selected?.id === action.id}
              className={cn(sideItem(selected?.id === action.id), "w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              <Zap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{action.name}</span>
            </button>
          </li>
        ))}
      </SideList>
      {selected ? (
        <Page>
          <div className="flex items-center gap-2 px-2.5">
            <h2 className="truncate text-[15px] font-semibold">{selected.name || "Untitled action"}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label={`Delete ${selected.name}`}
              onClick={() => {
                const rest = config.actions.filter((a) => a.id !== selected.id);
                setActions(rest);
                setSelectedId(rest[0]?.id ?? null);
              }}
            >
              <Trash2 />
            </Button>
          </div>
          <ActionEditor key={selected.id} action={selected} onChange={(action) => setActions(config.actions.map((a) => (a.id === action.id ? action : a)))} />
        </Page>
      ) : (
        <div className="grid h-full place-items-center p-10 text-center">
          <div className="flex max-w-sm flex-col items-center gap-2">
            <Zap className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-[13px] font-medium">Your own buttons on pull requests</p>
            <p className="text-[12px] text-muted-foreground">Hand a review to a teammate, ping a channel, label, run a script. They show up in each pull request's review window.</p>
          </div>
        </div>
      )}
    </div>
  );
}
