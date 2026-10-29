import type { RecipeId } from "@focus-diff/core/recipes";
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
  defaultConfig,
  filterRecipes,
  isRepoPattern,
  loadConfig,
  recipeOn,
  saveConfig,
  TEMPLATES,
  withRecipes,
  type AiProvider,
  type Config,
  type Queue,
  type QueueKind,
} from "@/utils/config/config";
import { interval, POLL_SECONDS } from "@/utils/copy/copy";
import { i18n, useT } from "@/utils/i18n/i18n";
import { isMac } from "@/utils/os/os";
import { platform } from "@/utils/platform/platform";
import { useTheme } from "@/utils/theme/theme";

const STEPS = ["github", "queues", "filters", "notifications", "ai", "ready"] as const;
const OFFERED: QueueKind[] = ["review", "involved", "authored", "merged"];
const OFFERED_RECIPES: RecipeId[] = ["stack", "tests", "generated", "infra", "database", "docs"];
const repoError = (s: string) => (isRepoPattern(s) ? null : i18n()("setup.repoError"));

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
          checked
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-input bg-(--field-bg) group-hover/choice:border-(--field-border-hover)",
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
  const [startRepos, setStartRepos] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<Set<RecipeId>>(() => new Set());
  const [statuses, setStatuses] = useState<AiStatus[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const t = useT();
  useTheme(config?.theme);

  useEffect(() => {
    void bridge
      .authStatus()
      .then(setAuth)
      .catch((error: unknown) => {
        console.error("Setup couldn't check GitHub", error);
        setAuth({
          signed_in: false,
          source: null,
          login: null,
          device_flow: false,
          gh_available: false,
          gh_signed_in: false,
        });
      });
    void (async () => {
      const c = await loadConfig({ create: false }).catch((error: unknown) => {
        console.error("Setup couldn't read the settings", error);
        return defaultConfig();
      });
      setConfig(c);
      setKinds(new Set(c.queues.filter((q) => q.enabled).map((q) => q.kind)));
      setRecipes(new Set(OFFERED_RECIPES.filter((id) => recipeOn(c.filters, id))));
      const shared = c.queues[0]?.repos ?? [];
      if (c.queues.every((q) => q.repos.join() === shared.join())) {
        setRepos(shared);
        setStartRepos(shared);
      }
    })();
    void bridge
      .aiStatuses()
      .then(setStatuses)
      .catch((error: unknown) => {
        console.error("Setup couldn't check the AI tools", error);
        setStatuses([]);
      });
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

  const finalConfig = (): Config => {
    const queues: Queue[] = [];
    for (const kind of OFFERED) {
      if (!kinds.has(kind)) continue;
      const had = config.queues.filter((q) => q.kind === kind);
      if (had.length === 0) queues.push({ ...TEMPLATES[kind].make(), repos });
      for (const q of had)
        queues.push({ ...q, enabled: true, repos: repos.join() === startRepos.join() ? q.repos : repos });
    }
    return {
      ...config,
      queues: [...queues, ...config.queues.filter((q) => q.kind === "custom")],
      filters: withRecipes(config.filters, recipes, t),
    };
  };

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(null);
    try {
      await saveConfig(finalConfig());
      await bridge.openPanel();
      await platform().closeWindow();
    } catch (error) {
      console.error("Setup couldn't finish", error);
      setFailed(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  const at = STEPS[step];
  const canContinue = at === "queues" ? kinds.size > 0 : true;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key !== "Enter" ||
      e.defaultPrevented ||
      (e.target instanceof Element && e.target.closest("input, textarea, button, [role=combobox], [role=listbox]"))
    )
      return;
    e.preventDefault();
    if (step === STEPS.length - 1) void finish();
    else if (canContinue) setStep(step + 1);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- only catches Return bubbling up from the controls inside, for the default button
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <header className="flex h-12 shrink-0 items-center gap-2 px-5" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <span className="text-body font-semibold">Focus Diff</span>
        <ol className="ml-auto flex items-center gap-1.5" aria-label={t("setup.steps")}>
          {STEPS.map((name, i) => (
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

      <main className="flex min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] flex-col overflow-y-auto px-8 pt-4 pb-6">
        {at === "github" ? (
          <section className="flex flex-col gap-6" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold text-balance">
                {t("setup.githubTitle")}
              </h1>
              <p className="text-body text-muted-foreground">{t("setup.githubBody")}</p>
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
            <p className="text-callout text-muted-foreground">{t("setup.tokenNote")}</p>
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
        ) : at === "filters" ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">
                {t("setup.filtersTitle")}
              </h1>
              <p className="text-body text-muted-foreground">{t("setup.filtersBody")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {filterRecipes(t)
                .filter((recipe) => OFFERED_RECIPES.includes(recipe.id))
                .map((recipe) => (
                  <Choice
                    key={recipe.id}
                    checked={recipes.has(recipe.id)}
                    onClick={() => {
                      setRecipes((now) => {
                        const next = new Set(now);
                        if (next.has(recipe.id)) next.delete(recipe.id);
                        else next.add(recipe.id);
                        return next;
                      });
                    }}
                    title={recipe.title}
                  >
                    {recipe.description}
                  </Choice>
                ))}
            </div>
            <p className="text-callout text-muted-foreground">{t("setup.filtersNote")}</p>
          </section>
        ) : at === "notifications" ? (
          <section className="flex flex-col gap-5" aria-labelledby="step-title">
            <div className="flex flex-col gap-1.5">
              <h1 id="step-title" className="text-title1 font-bold">
                {t("setup.notifyTitle")}
              </h1>
              <p className="text-body text-muted-foreground">{t("setup.notifyBody")}</p>
            </div>
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
                    {POLL_SECONDS.map((s) => (
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
                        {status.outdated
                          ? t("setup.outdatedRun", { command: status.update_command })
                          : t("setup.readyVersion", { version: status.version ?? "" })}
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
              {isMac ? t("setup.doneBodyMac") : t("setup.doneBodyTray")}
            </p>
          </section>
        )}
      </main>

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t px-5">
        {failed ? (
          <p className="truncate text-callout text-destructive" role="alert">
            {t("setup.finishFailed", { error: failed })}
          </p>
        ) : (
          <Button variant="link" className="px-0 text-callout" onClick={() => void bridge.reportProblem()}>
            {t("setup.trouble")}
          </Button>
        )}
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
          {step < STEPS.length - 1 ? (
            <Button
              className="min-w-20"
              onClick={() => {
                setStep(step + 1);
              }}
              disabled={!canContinue}
            >
              {at === "github" && !auth?.signed_in ? t("setup.later") : t("setup.continue")}
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
