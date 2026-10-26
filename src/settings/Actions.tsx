// The person's own buttons on pull requests: each runs its steps in order, from the panel and the
// review window. Commands ask for permission the first time they run (in Rust, not here).

import { ArrowDown, ArrowUp, Plus, Trash2, X, Zap } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newAction, STEP_KINDS, type Action, type ActionStep, type Config } from "@/lib/config";
import { i18n, useT, type T } from "@/lib/i18n";
import { Group, LinkRow, Pane, Row, SwitchRow, TWO_LINE_ITEM, useDetail } from "./Form";
import { TagInput } from "./TagInput";
import { confirmRemove } from "@/lib/confirm";

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

// Called as a reviewer is added, so it reads the words then.
const reviewerError = (v: string) => (/^[\w-]+(\/[\w.-]+)?$/.test(v) ? null : i18n()("settings.reviewerError"));
const PLACEHOLDERS = "{number} {title} {url} {repo} {author} {me}";

function StepEditor({ step, onChange }: { step: ActionStep; onChange: (step: ActionStep) => void }) {
  const id = useId();
  const t = useT();
  switch (step.kind) {
    case "comment":
      return (
        <div className="flex flex-col gap-1">
          <Textarea aria-label={t("settings.comment")} rows={3} value={step.body} onChange={(e) => onChange({ ...step, body: e.target.value })} placeholder={t("settings.commentPlaceholder")} />
          <p className="text-subheadline text-muted-foreground">{t("settings.commentHint", { placeholders: PLACEHOLDERS })}</p>
        </div>
      );
    case "request":
      return <TagInput label={t("settings.reviewers")} value={step.reviewers} onChange={(reviewers) => onChange({ ...step, reviewers })} placeholder={t("settings.reviewerPlaceholder")} validate={reviewerError} />;
    case "unrequestMe":
      return null;
    case "label":
      return <TagInput label={t("settings.labels")} value={step.labels} onChange={(labels) => onChange({ ...step, labels })} placeholder={t("settings.labelPlaceholder")} />;
    case "open":
      return (
        <div className="flex flex-col gap-1">
          <Input aria-label={t("settings.link")} className="font-mono text-callout" spellCheck={false} value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} />
          <p className="text-subheadline text-muted-foreground">{t("settings.linkHint", { placeholders: PLACEHOLDERS })}</p>
        </div>
      );
    case "run":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="sr-only">
            {t("settings.command")}
          </Label>
          <Textarea
            id={id}
            rows={3}
            className="font-mono text-callout"
            spellCheck={false}
            value={step.command}
            onChange={(e) => onChange({ ...step, command: e.target.value })}
            placeholder={'curl -s -X POST "$SLACK_WEBHOOK" -d "{\\"text\\": \\"Review please: $PR_URL\\"}"'}
          />
          <p className="text-subheadline text-muted-foreground">
            {t("settings.commandHintBefore")} <code className="font-mono">sh</code> {t("settings.commandHintMiddle")} <code className="font-mono">$PR_NUMBER $PR_TITLE $PR_URL $PR_REPO $PR_AUTHOR $GITHUB_LOGIN</code>. {t("settings.commandHintAfter")}
          </p>
        </div>
      );
  }
}

function ActionEditor({ action, onChange }: { action: Action; onChange: (action: Action) => void }) {
  const nameId = useId();
  const t = useT();
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
        <Row label={t("settings.button")} htmlFor={nameId}>
          <Input id={nameId} value={action.name} maxLength={30} onChange={(e) => onChange({ ...action, name: e.target.value })} className="w-56" />
        </Row>
        <SwitchRow checked={action.confirm} onChange={(confirm) => onChange({ ...action, confirm })} label={t("settings.confirm")} hint={t("settings.confirmHint")} />
      </Group>

      <Group title={t("settings.steps")} footer={t("settings.stepsFooter")}>
        {action.steps.length ? (
          <ol className="contents">
            {action.steps.map((step, i) => (
              <li key={i} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-fill text-subheadline font-medium tabular-nums">{i + 1}</span>
                  <span className="shrink-0 text-body">{t(`config.step.${step.kind}`)}</span>
                  <span className="hidden truncate text-subheadline text-muted-foreground sm:inline">{t(`settings.stepHint.${step.kind}`)}</span>
                  <div className="ml-auto flex shrink-0">
                    <Button variant="ghost" size="icon-xs" aria-label={t("settings.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={t("settings.moveDown")} disabled={i === action.steps.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={t("settings.removeStep", { number: i + 1 })} onClick={() => setStep(i, null)}>
                      <X />
                    </Button>
                  </div>
                </div>
                <StepEditor step={step} onChange={(next) => setStep(i, next)} />
              </li>
            ))}
          </ol>
        ) : null}
        <div className="px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={action.steps.length >= 10} />}>
              <Plus /> {t("settings.addStep")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {STEP_KINDS.map((kind) => (
                <DropdownMenuItem key={kind} className={TWO_LINE_ITEM} onClick={() => onChange({ ...action, steps: [...action.steps, newStep(kind)] })}>
                  <span>{t(`config.step.${kind}`)}</span>
                  <span className="text-subheadline text-muted-foreground">{t(`settings.stepHint.${kind}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Group>
    </>
  );
}

/** Small beside a group's heading, regular on its own in the empty pane. An action starts as a
 *  script, which can do anything; other steps are added in it. */
function AddAction({ config, onAdd, small = false }: { config: Config; onAdd: (action: Action) => void; small?: boolean }) {
  const t = useT();
  return (
    <Button variant="outline" size={small ? "sm" : "default"} disabled={config.actions.length >= 12} aria-label={t("settings.addActionLabel")} onClick={() => onAdd(newAction(t))}>
      <Plus /> {t("settings.add")}
    </Button>
  );
}

/** "Comment, then ask for reviews": each step after the first is said in lower case, as part of
 *  the sentence. */
const stepsSummary = (action: Action, t: T) =>
  action.steps.length
    ? action.steps
        .map((s) => t(`config.step.${s.kind}`))
        .reduce((said, label) => t("settings.stepsThen", { first: said, rest: label.toLocaleLowerCase(t.locale) }))
    : t("settings.noSteps");

export function Actions({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const selected = config.actions.find((a) => a.id === detail.openId) ?? null;
  const t = useT();
  const setActions = (actions: Action[]) => onChange({ ...config, actions });
  const add = (action: Action) => {
    setActions([...config.actions, action]);
    detail.open(action.id);
  };

  if (selected)
    return (
      <Pane
        title={selected.name || t("settings.untitledAction")}
        back={{ label: t("settings.pane.actions"), onBack: detail.close, ref: detail.backRef }}
        tools={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("settings.deleteNamed", { name: selected.name })}
            title={t("settings.deleteAction")}
            onClick={async () => {
              if (!(await confirmRemove(t("settings.removeActionConfirm", { name: selected.name || t("settings.untitledAction") })))) return;
              setActions(config.actions.filter((a) => a.id !== selected.id));
              detail.close();
            }}
          >
            <Trash2 />
          </Button>
        }
      >
        <ActionEditor key={selected.id} action={selected} onChange={(action) => setActions(config.actions.map((a) => (a.id === action.id ? action : a)))} />
      </Pane>
    );

  return (
    <Pane title={t("settings.pane.actions")} hero="actions">
      {config.actions.length ? (
        <>
          <Group title={t("settings.buttons")} accessory={<AddAction config={config} onAdd={add} small />}>
            {config.actions.map((action) => (
              <LinkRow
                key={action.id}
                ref={detail.rowRef(action.id)}
                leading={
                  <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-fill text-muted-foreground" aria-hidden>
                    <Zap className="size-3" strokeWidth={2.25} />
                  </span>
                }
                label={action.name || t("settings.untitledAction")}
                description={stepsSummary(action, t)}
                onOpen={() => detail.open(action.id)}
              />
            ))}
          </Group>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 pt-20 text-center">
          <Zap className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-body font-semibold">{t("settings.actionsEmpty")}</p>
          <p className="max-w-sm text-callout text-muted-foreground">{t("settings.actionsEmptyHint")}</p>
          <div className="mt-2">
            <AddAction config={config} onAdd={add} />
          </div>
        </div>
      )}
    </Pane>
  );
}
