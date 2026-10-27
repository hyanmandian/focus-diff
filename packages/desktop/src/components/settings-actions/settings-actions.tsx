// The person's own buttons on pull requests: each runs its steps in order, from the panel and the
// review window. Commands ask for permission the first time they run (in Rust, not here).

import { ArrowDown, ArrowUp, Plus, Trash2, X, Zap } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { Input } from "@/components/input/input";
import { Label } from "@/components/label/label";
import {
  Group,
  LinkRow,
  Pane,
  Row,
  SwitchRow,
  TWO_LINE_ITEM,
  useDetail,
} from "@/components/settings-form/settings-form";
import { TagInput } from "@/components/tag-input/tag-input";
import { Textarea } from "@/components/textarea/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";
import {
  newAction,
  newId,
  STEP_KINDS,
  type Action,
  type ActionChoice,
  type ActionStep,
  type Config,
} from "@/utils/config/config";
import { confirmRemove } from "@/utils/confirm/confirm";
import { i18n, useT, type T } from "@/utils/i18n/i18n";

/** Each kind of step as it starts, fresh each time. */
const NEW_STEP: { [K in ActionStep["kind"]]: () => Extract<ActionStep, { kind: K }> } = {
  comment: () => ({ kind: "comment", body: "" }),
  request: () => ({ kind: "request", reviewers: [] }),
  unrequestMe: () => ({ kind: "unrequestMe" }),
  label: () => ({ kind: "label", labels: [] }),
  open: () => ({ kind: "open", url: "https://" }),
  run: () => ({ kind: "run", command: "" }),
};
const newStep = (kind: ActionStep["kind"]): ActionStep => NEW_STEP[kind]();

// Called as a reviewer is added, so it reads the words then.
const reviewerError = (v: string) => (/^[\w-]+(?:\/[\w.-]+)?$/u.test(v) ? null : i18n()("settings.reviewerError"));
const PLACEHOLDERS = "{number} {title} {url} {repo} {author} {me}";

function StepEditor({ step, onChange }: { step: ActionStep; onChange: (step: ActionStep) => void }) {
  const id = useId();
  const t = useT();
  if (step.kind === "comment")
    return (
      <div className="flex flex-col gap-1">
        <Textarea
          aria-label={t("settings.comment")}
          rows={3}
          value={step.body}
          onChange={(e) => {
            onChange({ ...step, body: e.target.value });
          }}
          placeholder={t("settings.commentPlaceholder")}
        />
        <p className="text-subheadline text-muted-foreground">
          {t("settings.commentHint", { placeholders: PLACEHOLDERS })}
        </p>
      </div>
    );
  if (step.kind === "request")
    return (
      <TagInput
        label={t("settings.reviewers")}
        value={step.reviewers}
        onChange={(reviewers) => {
          onChange({ ...step, reviewers });
        }}
        placeholder={t("settings.reviewerPlaceholder")}
        validate={reviewerError}
      />
    );
  if (step.kind === "unrequestMe") return null;
  if (step.kind === "label")
    return (
      <TagInput
        label={t("settings.labels")}
        value={step.labels}
        onChange={(labels) => {
          onChange({ ...step, labels });
        }}
        placeholder={t("settings.labelPlaceholder")}
      />
    );
  if (step.kind === "open")
    return (
      <div className="flex flex-col gap-1">
        <Input
          aria-label={t("settings.link")}
          className="font-mono text-callout"
          spellCheck={false}
          value={step.url}
          onChange={(e) => {
            onChange({ ...step, url: e.target.value });
          }}
        />
        <p className="text-subheadline text-muted-foreground">
          {t("settings.linkHint", { placeholders: PLACEHOLDERS })}
        </p>
      </div>
    );
  // What's left is a script.
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
        onChange={(e) => {
          onChange({ ...step, command: e.target.value });
        }}
        placeholder={'curl -s -X POST "$SLACK_WEBHOOK" -d "{\\"text\\": \\"Review please: $PR_URL\\"}"'}
      />
      <p className="text-subheadline text-muted-foreground">
        {t("settings.commandHintBefore")} <code className="font-mono">sh</code> {t("settings.commandHintMiddle")}{" "}
        <code className="font-mono">$PR_NUMBER $PR_TITLE $PR_URL $PR_REPO $PR_AUTHOR $GITHUB_LOGIN</code>.{" "}
        {t("settings.commandHintAfter")}
      </p>
    </div>
  );
}

/** An action's (or a choice's) steps, in order, each editable, movable and removable. */
function StepsEditor({ steps, onChange }: { steps: ActionStep[]; onChange: (steps: ActionStep[]) => void }) {
  const t = useT();
  const setStep = (index: number, step: ActionStep | null) => {
    const next = [...steps];
    if (step) next[index] = step;
    else next.splice(index, 1);
    onChange(next);
  };
  const move = (index: number, by: number) => {
    const next = [...steps];
    next.splice(index + by, 0, ...next.splice(index, 1));
    onChange(next);
  };
  return (
    <>
      {steps.length > 0 ? (
        <ol className="contents">
          {steps.map((step, i) => (
            // Steps have no ids of their own; by place, a field keeps its focus while it's typed in.
            // oxlint-disable-next-line react/no-array-index-key -- see above
            <li key={i} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-fill text-subheadline font-medium tabular-nums">
                  {i + 1}
                </span>
                <span className="shrink-0 text-body">{t(`config.step.${step.kind}`)}</span>
                <span className="hidden truncate text-subheadline text-muted-foreground sm:inline">
                  {t(`settings.stepHint.${step.kind}`)}
                </span>
                <div className="ml-auto flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings.moveUp")}
                    disabled={i === 0}
                    onClick={() => {
                      move(i, -1);
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings.moveDown")}
                    disabled={i === steps.length - 1}
                    onClick={() => {
                      move(i, 1);
                    }}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings.removeStep", { number: i + 1 })}
                    onClick={() => {
                      setStep(i, null);
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
              <StepEditor
                step={step}
                onChange={(next) => {
                  setStep(i, next);
                }}
              />
            </li>
          ))}
        </ol>
      ) : null}
      <div className="px-3 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={steps.length >= 10} />}>
            <Plus /> {t("settings.addStep")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {STEP_KINDS.map((kind) => (
              <DropdownMenuItem
                key={kind}
                className={TWO_LINE_ITEM}
                onClick={() => {
                  onChange([...steps, newStep(kind)]);
                }}
              >
                <span>{t(`config.step.${kind}`)}</span>
                <span className="text-subheadline text-muted-foreground">{t(`settings.stepHint.${kind}`)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

/** One of a menu action's choices: its name, then its steps, in a group of its own. */
function ChoiceEditor({
  choice,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  choice: ActionChoice;
  index: number;
  count: number;
  onChange: (choice: ActionChoice) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const t = useT();
  return (
    <Group
      title={choice.name || t("settings.untitledAction")}
      accessory={
        <div className="flex">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("settings.moveUp")}
            disabled={index === 0}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("settings.moveDown")}
            disabled={index === count - 1}
            onClick={() => {
              onMove(1);
            }}
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("settings.removeChoice", { name: choice.name })}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      }
    >
      <Row label={t("settings.choiceName")} htmlFor={nameId}>
        <Input
          id={nameId}
          value={choice.name}
          maxLength={30}
          onChange={(e) => {
            onChange({ ...choice, name: e.target.value });
          }}
          className="w-56"
        />
      </Row>
      <StepsEditor
        steps={choice.steps}
        onChange={(steps) => {
          onChange({ ...choice, steps });
        }}
      />
    </Group>
  );
}

function ActionEditor({ action, onChange }: { action: Action; onChange: (action: Action) => void }) {
  const nameId = useId();
  const t = useT();
  const menu = action.choices.length > 0;
  const setChoices = (choices: ActionChoice[]) => {
    onChange({ ...action, choices });
  };
  const newChoice = (steps: ActionStep[] = [newStep("run")]): ActionChoice => ({
    id: newId(),
    name: t("settings.newChoice", { number: action.choices.length + 1 }),
    steps,
  });
  // A button's steps become the menu's first choice; back to a button, the first choice's steps
  // stay (after asking, when that drops other choices).
  const showAs = async (as: string) => {
    if (as === "menu" && !menu)
      onChange({ ...action, choices: [newChoice(action.steps.length > 0 ? action.steps : undefined)], steps: [] });
    if (as === "button" && menu) {
      if (
        action.choices.length > 1 &&
        !(await confirmRemove(t("settings.dropChoicesConfirm", { count: action.choices.length - 1 })))
      )
        return;
      onChange({ ...action, steps: action.choices[0]!.steps, choices: [] });
    }
  };
  const removeChoice = async (choice: ActionChoice) => {
    if (
      !(await confirmRemove(t("settings.removeChoiceConfirm", { name: choice.name || t("settings.untitledAction") })))
    )
      return;
    const choices = action.choices.filter((c) => c.id !== choice.id);
    // The last choice gone: a button again, with nothing to do yet.
    onChange({ ...action, choices, steps: choices.length > 0 ? action.steps : [] });
  };

  return (
    <>
      <Group>
        <Row label={t("settings.button")} htmlFor={nameId}>
          <Input
            id={nameId}
            value={action.name}
            maxLength={30}
            onChange={(e) => {
              onChange({ ...action, name: e.target.value });
            }}
            className="w-56"
          />
        </Row>
        <Row label={t("settings.showAs")} description={t("settings.showAsHint")}>
          <ToggleGroup
            value={[menu ? "menu" : "button"]}
            onValueChange={(v: string[]) => {
              if (v[0]) void showAs(v[0]);
            }}
            variant="outline"
            size="sm"
            aria-label={t("settings.showAs")}
          >
            <ToggleGroupItem value="button">{t("settings.showAs.button")}</ToggleGroupItem>
            <ToggleGroupItem value="menu">{t("settings.showAs.menu")}</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <SwitchRow
          checked={action.confirm}
          onChange={(confirm) => {
            onChange({ ...action, confirm });
          }}
          label={t("settings.confirm")}
          hint={t("settings.confirmHint")}
        />
      </Group>

      {menu ? (
        <>
          {action.choices.map((choice, i) => (
            <ChoiceEditor
              key={choice.id}
              choice={choice}
              index={i}
              count={action.choices.length}
              onChange={(next) => {
                setChoices(action.choices.map((c) => (c.id === next.id ? next : c)));
              }}
              onMove={(by) => {
                const choices = [...action.choices];
                choices.splice(i + by, 0, ...choices.splice(i, 1));
                setChoices(choices);
              }}
              onRemove={() => {
                void removeChoice(choice);
              }}
            />
          ))}
          <Button
            variant="outline"
            className="self-start"
            disabled={action.choices.length >= 12}
            onClick={() => {
              setChoices([...action.choices, newChoice()]);
            }}
          >
            <Plus /> {t("settings.addChoice")}
          </Button>
        </>
      ) : (
        <Group title={t("settings.steps")} footer={t("settings.stepsFooter")}>
          <StepsEditor
            steps={action.steps}
            onChange={(steps) => {
              onChange({ ...action, steps });
            }}
          />
        </Group>
      )}
    </>
  );
}

/** Small beside a group's heading, regular on its own in the empty pane. An action starts as a
 *  script, which can do anything; other steps are added in it. */
function AddAction({
  config,
  onAdd,
  small = false,
}: {
  config: Config;
  onAdd: (action: Action) => void;
  small?: boolean;
}) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size={small ? "sm" : "default"}
      disabled={config.actions.length >= 12}
      aria-label={t("settings.addActionLabel")}
      onClick={() => {
        onAdd(newAction(t));
      }}
    >
      <Plus /> {t("settings.add")}
    </Button>
  );
}

/** "Comment, then ask for reviews": each step after the first is said in lower case, as part of
 *  the sentence. */
const stepsSummary = (action: Action, t: T) =>
  action.choices.length > 0
    ? t("settings.menuOf", { choices: action.choices.map((c) => c.name).join(", ") })
    : action.steps.length > 0
      ? action.steps
          .map((s) => t(`config.step.${s.kind}`))
          .reduce((said, label) => t("settings.stepsThen", { first: said, rest: label.toLocaleLowerCase(t.locale) }))
      : t("settings.noSteps");

export function Actions({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const selected = config.actions.find((a) => a.id === detail.openId) ?? null;
  const t = useT();
  const setActions = (actions: Action[]) => {
    onChange({ ...config, actions });
  };
  const add = (action: Action) => {
    setActions([...config.actions, action]);
    detail.open(action.id);
  };
  const remove = async (action: Action) => {
    if (
      !(await confirmRemove(t("settings.removeActionConfirm", { name: action.name || t("settings.untitledAction") })))
    )
      return;
    setActions(config.actions.filter((a) => a.id !== action.id));
    detail.close();
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
            onClick={() => {
              void remove(selected);
            }}
          >
            <Trash2 />
          </Button>
        }
      >
        <ActionEditor
          key={selected.id}
          action={selected}
          onChange={(action) => {
            setActions(config.actions.map((a) => (a.id === action.id ? action : a)));
          }}
        />
      </Pane>
    );

  return (
    <Pane title={t("settings.pane.actions")} hero="actions">
      {config.actions.length > 0 ? (
        <Group title={t("settings.buttons")} accessory={<AddAction config={config} onAdd={add} small />}>
          {config.actions.map((action) => (
            <LinkRow
              key={action.id}
              ref={detail.rowRef(action.id)}
              leading={
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-fill text-muted-foreground"
                  aria-hidden
                >
                  <Zap className="size-3" strokeWidth={2.25} />
                </span>
              }
              label={action.name || t("settings.untitledAction")}
              description={stepsSummary(action, t)}
              onOpen={() => {
                detail.open(action.id);
              }}
            />
          ))}
        </Group>
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
