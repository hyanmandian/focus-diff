// First run: connect GitHub, pick queues, how to be told, and (optionally) an AI, in a minute.
// Opens on its own when there's no setup yet, and again from the panel's menu. Everything here
// can be changed later in Settings; the choices here are saved when you finish.

import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/button/button";
import { Connect } from "@/components/connect/connect";
import { Label } from "@/components/label/label";
import { Mark } from "@/components/mark/mark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";
import { Switch } from "@/components/switch/switch";
import { TagInput } from "@/components/tag-input/tag-input";
import { PROVIDERS } from "@/utils/ai/ai";
import { bridge, type AiStatus, type AuthStatus } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import {
  AI_PROVIDERS,
  loadConfig,
  saveConfig,
  TEMPLATES,
  type AiProvider,
  type Config,
  type Queue,
  type QueueKind,
} from "@/utils/config/config";
import { interval } from "@/utils/copy/copy";
import { i18n, useT } from "@/utils/i18n/i18n";
import { isMac } from "@/utils/os/os";
import { platform, supports } from "@/utils/platform/platform";
import { useTheme } from "@/utils/theme/theme";

const STEPS = ["github", "queues", "notifications", "ai", "ready"] as const;
const OFFERED: QueueKind[] = ["review", "involved", "authored", "merged"];
const repoError = (s: string) => (/^[\w.-]+\/(?:[\w.-]+|\*)$/u.test(s) ? null : i18n()("setup.repoError"));

/** A checkbox or radio button as macOS lays them out: the box on the leading edge, a 13pt label and
 *  an 11pt description under it. No card and no highlight under the pointer; the focus ring is on
 *  the box. */
function Choice({
  checked,
  onClick,
  title,
  children,
  kind = "checkbox",
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
  kind?: "checkbox" | "radio";
}) {
  return (
    <button
      type="button"
      role={kind}
      aria-checked={checked}
      onClick={onClick}
      className="group/choice flex w-full cursor-default items-start gap-2 py-1 text-left outline-none"
    >
      <span
        className={cn(
          "mt-px grid size-4 shrink-0 place-items-center border group-focus-visible/choice:outline-(length:--focus-ring-width) group-focus-visible/choice:outline-(--focus-ring) group-focus-visible/choice:outline-solid group-active/choice:brightness-95",
          kind === "radio" ? "rounded-full" : "rounded-(--radius-checkbox)",
          checked ? "border-transparent bg-primary text-primary-foreground" : "border-input bg-(--field-bg)",
        )}
        aria-hidden
      >
        {checked ? (
          kind === "radio" ? (
            <span className="size-1.5 rounded-full bg-primary-foreground" />
          ) : (
            <Check className="size-3" strokeWidth={3} />
          )
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body">{title}</span>
        <span className="text-subheadline text-muted-foreground">{children}</span>
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
  const t = useT();
  useTheme(config?.theme);

  useEffect(() => {
    void bridge.authStatus().then(setAuth);
    void (async () => {
      const c = await loadConfig();
      setConfig(c);
      setKinds(new Set(c.queues.filter((q) => q.enabled).map((q) => q.kind)));
      const shared = c.queues[0]?.repos ?? [];
      if (c.queues.every((q) => q.repos.join() === shared.join())) setRepos(shared);
    })();
    void bridge.aiStatuses().then(setStatuses);
  }, []);

  if (!config)
    return <Loader2 className="m-auto size-5 animate-spin text-muted-foreground" aria-label={t("setup.loading")} />;

  const toggle = (kind: QueueKind) => {
    setKinds((k) => {
      const next = new Set(k);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  /** The chosen queues: the ones you had stay as they were, new ones come from their template;
   *  your own searches are left alone. */
  const finalConfig = (): Config => {
    const queues: Queue[] = [];
    for (const kind of OFFERED) {
      if (!kinds.has(kind)) continue;
      const had = config.queues.filter((q) => q.kind === kind);
      if (had.length === 0) queues.push({ ...TEMPLATES[kind].make(), repos });
      for (const q of had) queues.push({ ...q, enabled: true, repos });
    }
    return { ...config, queues: [...queues, ...config.queues.filter((q) => q.kind === "custom")] };
  };

  const finish = async () => {
    setSaving(true);
    await saveConfig(finalConfig());
    await bridge.openPanel();
    await platform().closeWindow();
  };

  // Without the AI tools (the browser extension), there's no AI to pick.
  const steps = supports("ai") ? STEPS : STEPS.filter((s) => s !== "ai");
  const at = steps[step];
  const canContinue = at === "github" ? Boolean(auth?.signed_in) : at === "queues" ? kinds.size > 0 : true;
  // Return is the default button's (Continue, or Open Focus Diff at the end), unless a field or
  // another button has it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key !== "Enter" ||
      e.defaultPrevented ||
      (e.target instanceof Element && e.target.closest("input, textarea, button, [role=combobox], [role=listbox]"))
    )
      return;
    e.preventDefault();
    if (step === steps.length - 1) void finish();
    else if (canContinue) setStep(step + 1);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- only catches Return bubbling up from the controls inside, for the default button
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-5" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <span className="text-body font-semibold">Focus Diff</span>
        <ol className="ml-auto flex items-center gap-1.5" aria-label={t("setup.steps")}>
          {steps.map((name, i) => (
            <li
              key={name}
              aria-current={i === step ? "step" : undefined}
              title={t(`setup.step.${name}`)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-5 bg-primary" : i < step ? "w-1.5 bg-primary/60" : "w-1.5 bg-muted-foreground/30",
              )}
            >
              <span className="sr-only">{t(`setup.step.${name}`)}</span>
            </li>
          ))}
        </ol>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pt-4 pb-6">
        {at === "github" ? (
          <section className="flex flex-col gap-6" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold text-balance">
                {t("setup.githubTitle")}
              </h1>
              <p className="text-body text-muted-foreground">
                {t(supports("tray") ? "setup.githubBody" : "setup.githubBodyBrowser")}
              </p>
            </div>
            {auth?.signed_in ? (
              <div className="flex items-center gap-2">
                <Check className="size-4 text-success" aria-hidden />
                <p className="text-body">
                  {t("setup.connectedAs", { login: "\0" })
                    .split("\0")
                    .flatMap((part, i) =>
                      i
                        ? [
                            <span key="login" className="font-medium">
                              @{auth.login}
                            </span>,
                            part,
                          ]
                        : [part],
                    )}
                </p>
              </div>
            ) : auth ? (
              <Connect auth={auth} onConnected={() => void bridge.authStatus().then(setAuth)} />
            ) : (
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("setup.checkingGitHub")} />
            )}
            <p className="text-callout text-muted-foreground">
              {t(supports("tray") ? "setup.tokenNote" : "setup.tokenNoteBrowser")}
            </p>
          </section>
        ) : at === "queues" ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">
                {t("setup.queuesTitle")}
              </h1>
              <p className="text-body text-muted-foreground">{t("setup.queuesBody")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {OFFERED.map((kind) => (
                <Choice
                  key={kind}
                  checked={kinds.has(kind)}
                  onClick={() => {
                    toggle(kind);
                  }}
                  title={t(`config.queue.${kind}`)}
                >
                  {t(`config.queue.${kind}.hint`)}
                </Choice>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-body">{t("setup.onlyRepos")}</Label>
              <TagInput
                label={t("setup.repositories")}
                value={repos}
                onChange={setRepos}
                placeholder={t("setup.repoPlaceholder")}
                validate={repoError}
              />
              <p className="text-callout text-muted-foreground">{t("setup.reposEmpty")}</p>
            </div>
          </section>
        ) : at === "notifications" ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">
                {t("setup.notifyTitle")}
              </h1>
              <p className="text-body text-muted-foreground">
                {t(supports("tray") ? "setup.notifyBody" : "setup.notifyBodyBrowser")}
              </p>
            </div>
            {/* A grouped form, as System Settings draws one: rows on one rounded group, hairlines
                between them, a mini switch. */}
            <div className="flex flex-col divide-y divide-border rounded-(--radius-group) border bg-card">
              <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
                <Label htmlFor="sound">{t("setup.sound")}</Label>
                <Switch
                  id="sound"
                  size="sm"
                  checked={config.sound}
                  onCheckedChange={(sound) => {
                    setConfig({ ...config, sound });
                  }}
                />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
                <div>
                  <Label>{t("setup.checkEvery")}</Label>
                  <p className="text-subheadline text-muted-foreground">{t("setup.checkEveryHint")}</p>
                </div>
                <Select
                  value={String(config.pollSeconds)}
                  onValueChange={(v) => {
                    setConfig({ ...config, pollSeconds: Number(v) });
                  }}
                >
                  <SelectTrigger className="min-w-36" aria-label={t("setup.checkEvery")}>
                    <SelectValue>{(v: string) => interval(Number(v), t)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[30, 60, 90, 180, 300, 600].map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {interval(s, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        ) : at === "ai" ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">
                {t("setup.aiTitle")}
              </h1>
              <p className="text-body text-muted-foreground">{t("setup.aiBody")}</p>
            </div>
            <div role="radiogroup" aria-label={t("setup.ai")} className="flex flex-col gap-1.5">
              <Choice
                kind="radio"
                checked={!config.ai.provider}
                onClick={() => {
                  setConfig({ ...config, ai: { ...config.ai, provider: null } });
                }}
                title={t("setup.noAi")}
              >
                {t("setup.noAiHint")}
              </Choice>
              {statuses ? null : (
                <Loader2
                  className="size-4 animate-spin text-muted-foreground"
                  aria-label={t("setup.lookingForAgents")}
                />
              )}
              {statuses
                ? AI_PROVIDERS.map((provider: AiProvider) => {
                    const status = statuses.find((s) => s.provider === provider);
                    const ready = status?.installed && status.signed_in;
                    if (!ready) {
                      return (
                        <div
                          key={provider}
                          className="flex items-center gap-2 py-1 pl-6 text-body text-muted-foreground"
                        >
                          <span className="flex-1">
                            {PROVIDERS[provider].name} ·{" "}
                            {status?.installed ? (
                              <>
                                {t("setup.signedOutRun")}{" "}
                                <code className="font-mono text-callout">{status.login_command}</code>
                              </>
                            ) : (
                              t("setup.notInstalled")
                            )}
                          </span>
                          {status?.installed ? null : (
                            <Button
                              variant="link"
                              size="xs"
                              onClick={() => void bridge.openUrl(PROVIDERS[provider].install)}
                            >
                              {t("setup.getIt")} <ExternalLink />
                            </Button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <Choice
                        key={provider}
                        kind="radio"
                        checked={config.ai.provider === provider}
                        onClick={() => {
                          setConfig({
                            ...config,
                            ai: {
                              ...config.ai,
                              provider,
                              model: provider === config.ai.provider ? config.ai.model : "",
                              effort: provider === config.ai.provider ? config.ai.effort : "",
                            },
                          });
                        }}
                        title={PROVIDERS[provider].name}
                      >
                        {t("setup.readyVersion", { version: status.version ?? "" })}
                      </Choice>
                    );
                  })
                : null}
            </div>
          </section>
        ) : (
          <section
            className="m-auto flex max-w-sm flex-col items-center gap-4 text-center"
            aria-labelledby="step-title"
          >
            <Mark className="size-12 text-primary" />
            <h1 id="step-title" className="text-title1 font-bold">
              {t("setup.doneTitle")}
            </h1>
            <p className="text-body text-muted-foreground">
              {supports("tray")
                ? isMac
                  ? t("setup.doneBodyMac")
                  : t("setup.doneBodyTray")
                : t("setup.doneBodyBrowser")}
            </p>
          </section>
        )}
      </main>

      {/* Back beside Continue at the bottom right, as in the Mac's Setup Assistant; Continue is the
          default button. */}
      <footer className="flex h-14 shrink-0 items-center gap-2 border-t px-5">
        <div className="ml-auto flex items-center gap-2">
          {at === "ai" && !config.ai.provider ? (
            <span className="text-callout text-muted-foreground">{t("setup.laterAi")}</span>
          ) : null}
          {step > 0 ? (
            <Button
              variant="outline"
              className="min-w-20"
              onClick={() => {
                setStep(step - 1);
              }}
            >
              {t("setup.back")}
            </Button>
          ) : null}
          {step < steps.length - 1 ? (
            <Button
              className="min-w-20"
              onClick={() => {
                setStep(step + 1);
              }}
              disabled={!canContinue}
            >
              {t("setup.continue")}
            </Button>
          ) : (
            <Button onClick={() => void finish()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null} {t("setup.open")}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
