// The person's own action buttons on a pull request (set up in Settings → Actions): as toolbar
// buttons while there's room, as items of a pull-down menu once there isn't. One that asks first
// asks with a native alert, as the Mac does before something that can't be taken back.

import { Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { runAction, STEP_LABELS } from "@/lib/actions";
import { bridge, type ActionContext } from "@/lib/bridge";
import type { Action } from "@/lib/config";

type Result = (message: string, ok: boolean) => void;

/** Runs an action, after asking when it's set to ask. */
function useRun(action: Action, pr: ActionContext, onResult: Result) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (action.confirm) {
      const steps = action.steps
        .map((step) => `${STEP_LABELS[step.kind]}${step.kind === "request" && step.reviewers.length ? `: ${step.reviewers.join(", ")}` : step.kind === "label" && step.labels.length ? `: ${step.labels.join(", ")}` : ""}`)
        .join("\n");
      if (!(await bridge.confirm(`${action.name} #${pr.number}?`, steps, action.name))) return;
    }
    setBusy(true);
    try {
      onResult(await runAction(action, pr), true);
    } catch (e) {
      onResult(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function ActionButton({ action, pr, className, onResult }: { action: Action; pr: ActionContext; className?: string; onResult: Result }) {
  const { busy, run } = useRun(action, pr, onResult);
  return (
    <Button variant="ghost" className={className} disabled={busy || !action.steps.length} onClick={() => void run()}>
      {busy ? <Loader2 className="animate-spin" /> : <Zap />} {action.name}
      {action.confirm ? "…" : ""}
    </Button>
  );
}

function ActionItem({ action, pr, onResult }: { action: Action; pr: ActionContext; onResult: Result }) {
  const { busy, run } = useRun(action, pr, onResult);
  return (
    <DropdownMenuItem disabled={busy || !action.steps.length} onClick={() => void run()}>
      {action.name}
      {action.confirm ? "…" : ""}
    </DropdownMenuItem>
  );
}

export function ActionButtons({ actions, pr, className, onResult }: { actions: Action[]; pr: ActionContext | null; className?: string; onResult: Result }) {
  if (!pr || !actions.length) return null;
  return (
    <>
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} pr={pr} className={className} onResult={onResult} />
      ))}
    </>
  );
}

/** The same actions as menu items, for a pull-down menu. */
export function ActionMenuItems({ actions, pr, onResult }: { actions: Action[]; pr: ActionContext | null; onResult: Result }) {
  if (!pr || !actions.length) return null;
  return (
    <>
      {actions.map((action) => (
        <ActionItem key={action.id} action={action} pr={pr} onResult={onResult} />
      ))}
    </>
  );
}
