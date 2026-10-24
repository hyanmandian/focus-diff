// The person's own action buttons on a pull request (set up in Settings → Actions).

import { Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { runAction, STEP_LABELS } from "@/lib/actions";
import type { ActionContext } from "@/lib/bridge";
import type { Action } from "@/lib/config";

function ActionButton({ action, pr, size, onResult }: { action: Action; pr: ActionContext; size: "xs" | "sm"; onResult: (message: string, ok: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const run = async () => {
    setOpen(false);
    setBusy(true);
    try {
      onResult(await runAction(action, pr), true);
    } catch (e) {
      onResult(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };
  const icon = busy ? <Loader2 className="animate-spin" /> : <Zap />;
  if (!action.confirm) {
    return (
      <Button variant="outline" size={size} disabled={busy || !action.steps.length} onClick={() => void run()}>
        {icon} {action.name}
      </Button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size={size} disabled={busy || !action.steps.length} />}>
        {icon} {action.name}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <p className="text-[13px] font-medium">
          {action.name} #{pr.number}?
        </p>
        <ol className="list-decimal pl-4 text-xs text-muted-foreground">
          {action.steps.map((step, i) => (
            <li key={i}>{STEP_LABELS[step.kind]}{step.kind === "request" && step.reviewers.length ? `: ${step.reviewers.join(", ")}` : step.kind === "label" && step.labels.length ? `: ${step.labels.join(", ")}` : ""}</li>
          ))}
        </ol>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void run()}>
            Run
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ActionButtons({ actions, pr, size = "sm", onResult }: { actions: Action[]; pr: ActionContext | null; size?: "xs" | "sm"; onResult: (message: string, ok: boolean) => void }) {
  if (!pr || !actions.length) return null;
  return (
    <>
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} pr={pr} size={size} onResult={onResult} />
      ))}
    </>
  );
}
