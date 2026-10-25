// Choosing the optional AI: none (the default), or the coding agent CLI the person already uses,
// with what's installed and signed in on this machine; then how it's asked: model, effort, the
// person's own review guidelines and the prompts offered on each pull request.

import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EFFORT_LABELS, PROVIDERS } from "@/lib/ai";
import { bridge, type AiStatus } from "@/lib/bridge";
import { AI_PROVIDERS, defaultPrompts, newId, type AiProvider, type Config, type Effort, type Prompt } from "@/lib/config";
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
  const effortId = useId();
  const guidelinesId = useId();
  const [models, setModels] = useState<string[]>([]);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatuses(await bridge.aiStatuses());
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => void check(), [check]);

  const selected = config.ai.provider;
  const ai = config.ai;
  const setAi = (patch: Partial<Config["ai"]>) => onChange({ ...config, ai: { ...ai, ...patch } });
  // Model and effort belong to one CLI: another starts from its defaults.
  const choose = (provider: AiProvider | null) => setAi(provider === ai.provider ? {} : { provider, model: "", effort: "" });
  useEffect(() => {
    setModels([]);
    if (selected) void bridge.aiModels(selected).then(setModels, () => setModels([]));
  }, [selected]);
  const setPrompts = (prompts: Prompt[]) => setAi({ prompts });
  const updatePrompt = (id: string, patch: Partial<Prompt>) => setPrompts(ai.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const movePrompt = (index: number, by: number) => {
    const prompts = [...ai.prompts];
    const [prompt] = prompts.splice(index, 1);
    if (!prompt) return;
    prompts.splice(index + by, 0, prompt);
    setPrompts(prompts);
  };

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
        {[null, ...AI_PROVIDERS].map((provider) => {
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
        <>
          <div className="flex flex-wrap gap-4">
            <div className="flex min-w-60 flex-1 flex-col gap-1.5">
              <Label htmlFor={modelId} className="text-[13px]">
                Model
              </Label>
              <Input
                id={modelId}
                list={`${modelId}-list`}
                className="font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
                value={ai.model}
                onChange={(e) => setAi({ model: e.target.value })}
                placeholder={`${PROVIDERS[selected].name}'s own default`}
              />
              <datalist id={`${modelId}-list`}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">Empty uses what you've set in {PROVIDERS[selected].name}. Some plans only allow some models.</p>
            </div>
            <div className="flex w-40 flex-col gap-1.5">
              <Label htmlFor={effortId} className="text-[13px]">
                Effort
              </Label>
              {PROVIDERS[selected].efforts.length ? (
                <Select value={ai.effort} onValueChange={(v) => setAi({ effort: (v ?? "") as Effort | "" })} items={PROVIDERS[selected].efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] }))}>
                  <SelectTrigger id={effortId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS[selected].efforts.map((e) => (
                      <SelectItem key={e} value={e}>
                        {EFFORT_LABELS[e]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="pt-1.5 text-xs text-muted-foreground">Part of the model you pick (a thinking model thinks harder).</p>
              )}
              {PROVIDERS[selected].efforts.length ? <p className="text-xs text-muted-foreground">Higher is slower and uses more of your plan.</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={guidelinesId} className="text-[13px]">
              Your review guidelines
            </Label>
            <Textarea
              id={guidelinesId}
              className="min-h-20 text-[13px]"
              value={ai.instructions}
              maxLength={4000}
              onChange={(e) => setAi({ instructions: e.target.value })}
              placeholder="Added to every question. For example: We use React Query; point out missing loading and error states. Ignore formatting, a linter handles it."
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-medium">Prompts</h3>
              <span className="text-xs text-muted-foreground">Buttons on each pull request.</span>
              <Button variant="link" size="xs" className="ml-auto" onClick={() => setPrompts(defaultPrompts())}>
                Restore the defaults
              </Button>
            </div>
            {ai.prompts.map((p, i) => (
              <div key={p.id} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex items-center gap-1">
                  <Input aria-label="Button name" className="h-7 max-w-52 text-[13px] font-medium" maxLength={30} value={p.name} onChange={(e) => updatePrompt(p.id, { name: e.target.value })} />
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => movePrompt(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Move ${p.name} down`} disabled={i === ai.prompts.length - 1} onClick={() => movePrompt(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${p.name}`} onClick={() => setPrompts(ai.prompts.filter((x) => x.id !== p.id))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea aria-label={`What ${p.name} asks`} className="min-h-16 text-[13px]" maxLength={8000} value={p.prompt} onChange={(e) => updatePrompt(p.id, { prompt: e.target.value })} />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={ai.prompts.length >= 12}
              onClick={() => setPrompts([...ai.prompts, { id: newId(), name: "New prompt", prompt: "What should I ask the author before approving?" }])}
            >
              <Plus /> Add a prompt
            </Button>
            <p className="text-xs text-muted-foreground">Each one gets the pull request's description and diff, and your guidelines. You can also ask anything from the pull request itself.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
