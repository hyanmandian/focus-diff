// First run: connect GitHub, pick queues, how to be told, and (optionally) an AI, in a minute.
// Opens on its own when there's no setup yet, and again from the panel's menu. Everything here
// can be changed later in Settings; the choices here are saved when you finish.

import { Check, ExternalLink, Loader2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PROVIDERS } from "@/lib/ai";
import { bridge, type AiStatus, type AuthStatus } from "@/lib/bridge";
import { AI_PROVIDERS, loadConfig, saveConfig, TEMPLATES, type AiProvider, type Config, type QueueKind } from "@/lib/config";
import { interval } from "@/lib/copy";
import { useTheme } from "@/lib/theme";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { TagInput } from "@/settings/TagInput";
import { Connect } from "@/shared/Connect";
import { Mark } from "@/shared/Mark";

const STEPS = ["GitHub", "Queues", "Notifications", "AI", "Ready"] as const;
const OFFERED: QueueKind[] = ["review", "involved", "authored", "merged"];
const repoError = (s: string) => (/^[\w.-]+\/(?:[\w.-]+|\*)$/.test(s) ? null : "Use owner/name, or owner/* for all of an owner's");

/** A checkbox or radio button as macOS lays them out: the box on the leading edge, a 13pt label and
 *  an 11pt description under it. No card and no highlight under the pointer; the focus ring is on
 *  the box. */
function Choice({ checked, onClick, title, children, role = "checkbox" }: { checked: boolean; onClick: () => void; title: string; children?: ReactNode; role?: "checkbox" | "radio" }) {
  return (
    <button type="button" role={role} aria-checked={checked} onClick={onClick} className="group/choice flex w-full cursor-default items-start gap-2 py-1 text-left outline-none">
      <span
        className={cn(
          "mt-px grid size-4 shrink-0 place-items-center border group-focus-visible/choice:outline-(length:--focus-ring-width) group-focus-visible/choice:outline-(--focus-ring) group-focus-visible/choice:outline-solid group-active/choice:brightness-95",
          role === "radio" ? "rounded-full" : "rounded-(--radius-checkbox)",
          checked ? "border-transparent bg-primary text-primary-foreground" : "border-input bg-(--field-bg)",
        )}
        aria-hidden
      >
        {checked ? role === "radio" ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body">{title}</span>
        {children ? <span className="text-subheadline text-muted-foreground">{children}</span> : null}
      </span>
    </button>
  );
}

export function Setup() {
  const [step, setStep] = useState(0);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [kinds, setKinds] = useState<Set<QueueKind>>(new Set());
  const [repos, setRepos] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<AiStatus[] | null>(null);
  const [saving, setSaving] = useState(false);
  useTheme(config?.theme);

  useEffect(() => {
    void bridge.authStatus().then(setAuth);
    void loadConfig().then((c) => {
      setConfig(c);
      setKinds(new Set(c.queues.filter((q) => q.enabled).map((q) => q.kind)));
      const shared = c.queues[0]?.repos ?? [];
      if (c.queues.every((q) => q.repos.join() === shared.join())) setRepos(shared);
    });
    void bridge.aiStatuses().then(setStatuses);
  }, []);

  if (!config) return <Loader2 className="m-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" />;

  const toggle = (kind: QueueKind) =>
    setKinds((k) => {
      const next = new Set(k);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  /** The chosen queues: the ones you had stay as they were, new ones come from their template;
   *  your own searches are left alone. */
  const finalConfig = (): Config => {
    const queues = OFFERED.flatMap((kind) => {
      if (!kinds.has(kind)) return [];
      const had = config.queues.filter((q) => q.kind === kind);
      return (had.length ? had.map((q) => ({ ...q, enabled: true })) : [TEMPLATES[kind].make()]).map((q) => ({ ...q, repos }));
    });
    return { ...config, queues: [...queues, ...config.queues.filter((q) => q.kind === "custom")] };
  };

  const finish = async () => {
    setSaving(true);
    await saveConfig(finalConfig());
    await bridge.openPanel();
    await getCurrentWindow().close();
  };

  const canContinue = step === 0 ? Boolean(auth?.signed_in) : step === 1 ? kinds.size > 0 : true;
  // Return is the default button's (Continue, or Open Focus Diff at the end), unless a field or
  // another button has it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.defaultPrevented || (e.target as HTMLElement).closest("input, textarea, button, [role=combobox], [role=listbox]")) return;
    e.preventDefault();
    if (step === STEPS.length - 1) void finish();
    else if (canContinue) setStep(step + 1);
  };

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-5" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <span className="text-body font-semibold">Focus Diff</span>
        <ol className="ml-auto flex items-center gap-1.5" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name} aria-current={i === step ? "step" : undefined} title={name} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : i < step ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted-foreground/30")}>
              <span className="sr-only">{name}</span>
            </li>
          ))}
        </ol>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pt-4 pb-6">
        {step === 0 ? (
          <section className="flex flex-col gap-6" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold text-balance">Your reviews, without opening GitHub</h1>
              <p className="text-body text-muted-foreground">Focus Diff sits in your menu bar, tells you when a pull request needs you, and lets you read, review and merge it right there. First, connect GitHub.</p>
            </div>
            {auth?.signed_in ? (
              <div className="flex items-center gap-2">
                <Check className="size-4 text-success" aria-hidden />
                <p className="text-body">
                  Connected as <span className="font-medium">@{auth.login}</span>
                </p>
              </div>
            ) : auth ? (
              <Connect auth={auth} onConnected={() => void bridge.authStatus().then(setAuth)} />
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Checking GitHub" />
            )}
            <p className="text-callout text-muted-foreground">Your token stays in the system keychain (or with the GitHub CLI) and only ever goes to GitHub. Focus Diff has no server.</p>
          </section>
        ) : step === 1 ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">What should it watch?</h1>
              <p className="text-body text-muted-foreground">Each is a queue in the panel. Later, in Settings, you can narrow them down (teams, labels, files) or add searches of your own.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {OFFERED.map((kind) => (
                <Choice key={kind} checked={kinds.has(kind)} onClick={() => toggle(kind)} title={TEMPLATES[kind].name}>
                  {TEMPLATES[kind].description}
                </Choice>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-body">Only in these repositories (optional)</Label>
              <TagInput label="Repositories" value={repos} onChange={setRepos} placeholder="acme/web or acme/*" validate={repoError} />
              <p className="text-callout text-muted-foreground">Empty: every repository you can see.</p>
            </div>
          </section>
        ) : step === 2 ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">How should it tell you?</h1>
              <p className="text-body text-muted-foreground">
                A notification and the menu bar icon's animation when something new needs you: a review request, new commits or replies on what you reviewed, approvals and failing
                CI on yours. What each queue tells you about can be changed in Settings.
              </p>
            </div>
            {/* A grouped form, as System Settings draws one: rows on one rounded group, hairlines
                between them, a mini switch. */}
            <div className="flex flex-col divide-y divide-border rounded-(--radius-group) border bg-card">
            <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
              <Label htmlFor="sound">Play a sound</Label>
              <Switch id="sound" size="sm" checked={config.sound} onCheckedChange={(sound) => setConfig({ ...config, sound })} />
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
              <div>
                <Label>Check GitHub every</Label>
                <p className="text-subheadline text-muted-foreground">Only what changed is downloaded again.</p>
              </div>
              <Select value={String(config.pollSeconds)} onValueChange={(v) => setConfig({ ...config, pollSeconds: Number(v) })}>
                <SelectTrigger className="min-w-36" aria-label="Check GitHub every">
                  <SelectValue>{(v: string) => interval(Number(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[30, 60, 90, 180, 300, 600].map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {interval(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </div>
          </section>
        ) : step === 3 ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">Want a second pair of eyes?</h1>
              <p className="text-body text-muted-foreground">
                Optional. Summaries, problems worth a look and answers about a pull request, from the coding agent you already use, on your own plan. It runs on this computer and can't
                change anything.
              </p>
            </div>
            <div role="radiogroup" aria-label="AI" className="flex flex-col gap-1.5">
              <Choice role="radio" checked={!config.ai.provider} onClick={() => setConfig({ ...config, ai: { ...config.ai, provider: null } })} title="No AI">
                Everything works without it.
              </Choice>
              {!statuses ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Looking for coding agents" /> : null}
              {statuses
                ? AI_PROVIDERS.map((provider: AiProvider) => {
                    const status = statuses.find((s) => s.provider === provider);
                    const ready = status?.installed && status.signed_in;
                    if (!ready) {
                      return (
                        <div key={provider} className="flex items-center gap-2 py-1 pl-6 text-body text-muted-foreground">
                          <span className="flex-1">
                            {PROVIDERS[provider].name} · {status?.installed ? <>signed out: run <code className="font-mono text-callout">{status.login_command}</code></> : "not installed"}
                          </span>
                          {!status?.installed ? (
                            <Button variant="link" size="xs" onClick={() => void bridge.openUrl(PROVIDERS[provider].install)}>
                              Get it <ExternalLink />
                            </Button>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <Choice
                        key={provider}
                        role="radio"
                        checked={config.ai.provider === provider}
                        onClick={() => setConfig({ ...config, ai: { ...config.ai, provider, model: provider === config.ai.provider ? config.ai.model : "", effort: provider === config.ai.provider ? config.ai.effort : "" } })}
                        title={PROVIDERS[provider].name}
                      >
                        Ready · {status.version}
                      </Choice>
                    );
                  })
                : null}
            </div>
          </section>
        ) : (
          <section className="m-auto flex max-w-sm flex-col items-center gap-4 text-center" aria-labelledby="step-title">
            <Mark className="size-12 text-primary" />
            <h1 id="step-title" className="text-title1 font-bold">You're set</h1>
            <p className="text-body text-muted-foreground">
              Focus Diff lives in your menu bar{isMac ? "" : " (the system tray)"}. Click its icon for your queues; it'll light up when something needs you. Model, effort,
              your own prompts and buttons are in Settings.
            </p>
          </section>
        )}
      </main>

      {/* Back beside Continue at the bottom right, as in the Mac's Setup Assistant; Continue is the
          default button. */}
      <footer className="flex h-14 shrink-0 items-center gap-2 border-t px-5">
        <div className="ml-auto flex items-center gap-2">
          {step === 3 && !config.ai.provider ? <span className="text-callout text-muted-foreground">You can turn it on later.</span> : null}
          {step > 0 ? (
            <Button variant="outline" className="min-w-20" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <Button className="min-w-20" onClick={() => setStep(step + 1)} disabled={!canContinue}>
              Continue
            </Button>
          ) : (
            <Button onClick={() => void finish()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} Open Focus Diff
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
