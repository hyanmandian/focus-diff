// The person's own action buttons on a pull request (set up in Settings → Actions): as toolbar
// buttons while there's room, as items of a pull-down menu once there isn't. One that asks first
// asks with a native alert, as the Mac does before something that can't be taken back.

import { ChevronDown, Loader2, Zap } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { runAction } from "@/utils/actions/actions";
import { bridge, type ActionContext } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import { choiceAction, type Action } from "@/utils/config/config";
import { errorText } from "@/utils/error/error";
import { useT } from "@/utils/i18n/i18n";

type Result = (message: string, ok: boolean) => void;

/** Runs an action, after asking when it's set to ask. */
function useRun(action: Action, pr: ActionContext, onResult: Result) {
  const [busy, setBusy] = useState(false);
  const t = useT();
  const run = async () => {
    if (action.confirm) {
      const steps = action.steps
        .map(
          (step) =>
            `${t(`config.step.${step.kind}`)}${step.kind === "request" && step.reviewers.length > 0 ? `: ${step.reviewers.join(", ")}` : step.kind === "label" && step.labels.length > 0 ? `: ${step.labels.join(", ")}` : ""}`,
        )
        .join("\n");
      if (
        !(await bridge.confirm(
          t("shared.actionConfirm", { action: action.name, number: String(pr.number) }),
          steps,
          action.name,
        ))
      )
        return;
    }
    setBusy(true);
    try {
      onResult(await runAction(action, pr), true);
    } catch (e) {
      onResult(errorText(e), false);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** A menu action: a pull-down button of its choices, as Mail's Move to. */
function ActionPullDown({
  action,
  pr,
  className,
  onResult,
}: {
  action: Action;
  pr: ActionContext;
  className?: string;
  onResult: Result;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className={cn(className, "gap-1")} />}>
        <Zap /> {action.name}
        <ChevronDown className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ChoiceItems action={action} pr={pr} onResult={onResult} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChoiceItems({ action, pr, onResult }: { action: Action; pr: ActionContext; onResult: Result }) {
  return (
    <>
      {action.choices.map((choice) => (
        <ActionItem
          key={choice.id}
          action={choiceAction(action, choice)}
          label={choice.name}
          pr={pr}
          onResult={onResult}
        />
      ))}
    </>
  );
}

function ActionButton({
  action,
  pr,
  className,
  onResult,
}: {
  action: Action;
  pr: ActionContext;
  className?: string;
  onResult: Result;
}) {
  const { busy, run } = useRun(action, pr, onResult);
  if (action.choices.length > 0)
    return <ActionPullDown action={action} pr={pr} className={className} onResult={onResult} />;
  return (
    <Button
      variant="ghost"
      className={className}
      disabled={busy || action.steps.length === 0}
      onClick={() => void run()}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Zap />} {action.name}
      {action.confirm ? "…" : ""}
    </Button>
  );
}

function ActionItem({
  action,
  label = action.name,
  pr,
  onResult,
}: {
  action: Action;
  label?: string;
  pr: ActionContext;
  onResult: Result;
}) {
  const { busy, run } = useRun(action, pr, onResult);
  return (
    <DropdownMenuItem disabled={busy || action.steps.length === 0} onClick={() => void run()}>
      {label}
      {action.confirm ? "…" : ""}
    </DropdownMenuItem>
  );
}

export function ActionButtons({
  actions,
  pr,
  className,
  onResult,
}: {
  actions: Action[];
  pr: ActionContext | null;
  className?: string;
  onResult: Result;
}) {
  if (!pr || actions.length === 0) return null;
  return (
    <>
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} pr={pr} className={className} onResult={onResult} />
      ))}
    </>
  );
}

/** The same actions as menu items, for a pull-down menu. */
export function ActionMenuItems({
  actions,
  pr,
  onResult,
}: {
  actions: Action[];
  pr: ActionContext | null;
  onResult: Result;
}) {
  if (!pr || actions.length === 0) return null;
  return (
    <>
      {actions.map((action) =>
        // In a menu already, a menu action's choices are a submenu.
        action.choices.length > 0 ? (
          <DropdownMenuSub key={action.id}>
            <DropdownMenuSubTrigger>{action.name}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <ChoiceItems action={action} pr={pr} onResult={onResult} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <ActionItem key={action.id} action={action} pr={pr} onResult={onResult} />
        ),
      )}
    </>
  );
}
