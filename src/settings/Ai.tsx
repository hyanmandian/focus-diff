// Choosing the optional AI: none (the default), or the coding agent CLI the person already uses,
// with what's installed and signed in on this machine.

import { Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROVIDERS } from "@/lib/ai";
import { bridge, type AiStatus } from "@/lib/bridge";
import type { AiProvider, Config } from "@/lib/config";
import { cn } from "@/lib/utils";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${command}`}
        onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}

export function Ai({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const [statuses, setStatuses] = useState<AiStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const modelId = useId();
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatuses(await bridge.aiStatuses());
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => void check(), [check]);

  const choose = (provider: AiProvider | null) => onChange({ ...config, ai: { provider, model: provider === config.ai.provider ? config.ai.model : "" } });
  const selected = config.ai.provider;

  return (
    <div className="flex max-w-xl flex-col gap-6 p-6">
      <div>
        <h2 className="text-base font-semibold">AI</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. Summaries and a second pair of eyes on pull requests, from the coding agent you already use, on your own plan. When you ask, Focus Diff runs it on
          this computer with the pull request's description and diff, without tools: it answers, it can't change files or run commands. Nothing goes through us.
        </p>
      </div>

      <div role="radiogroup" aria-label="AI" className="flex flex-col gap-2">
        {[null, ...(Object.keys(PROVIDERS) as AiProvider[])].map((provider) => {
          const status = provider ? statuses?.find((s) => s.provider === provider) : null;
          const active = selected === provider;
          return (
            <div key={provider ?? "none"} className={cn("rounded-xl border transition-colors", active ? "border-primary bg-primary/5" : "hover:bg-foreground/5")}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(provider)}
                className="flex w-full items-center gap-3 rounded-xl px-3 pt-3 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", active && "border-primary")} aria-hidden>
                  {active ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="text-sm font-medium">{provider ? PROVIDERS[provider].name : "No AI"}</span>
              </button>
              <p className="px-3 pb-3 pl-10 text-xs text-muted-foreground">
                {!provider ? (
                  "Everything works without it."
                ) : !statuses ? (
                  "Checking…"
                ) : !status?.installed ? (
                  <>
                    Not installed on this computer.{" "}
                    <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => void bridge.openUrl(PROVIDERS[provider].install)}>
                      Get it <ExternalLink />
                    </Button>
                  </>
                ) : status.signed_in ? (
                  <span className="text-success">Ready · {status.version}</span>
                ) : (
                  <>
                    Installed, not signed in. In a terminal, run <CopyCommand command={status.login_command} />
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void check()} disabled={checking}>
          {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
        </Button>
        <span className="text-xs text-muted-foreground">After installing or signing in.</span>
      </div>

      {selected ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={modelId} className="text-[13px]">
            Model
          </Label>
          <Input
            id={modelId}
            className="max-w-72 font-mono text-xs"
            spellCheck={false}
            value={config.ai.model}
            onChange={(e) => onChange({ ...config, ai: { ...config.ai, model: e.target.value } })}
            placeholder={`${PROVIDERS[selected].name}'s own default`}
          />
          <p className="text-xs text-muted-foreground">Leave empty to use what you've set in {PROVIDERS[selected].name}. Some plans only allow some models.</p>
        </div>
      ) : null}
    </div>
  );
}
