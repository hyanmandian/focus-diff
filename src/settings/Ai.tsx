// Choosing the optional AI: none (the default), or the coding agent CLI the person already uses,
// with what's installed and signed in on this machine; then how it's asked: model, effort, the
// person's own review guidelines and the prompts offered on each pull request.

import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PROVIDERS } from "@/lib/ai";
import { bridge, type AiStatus } from "@/lib/bridge";
import { AI_PROVIDERS, defaultPrompts, newId, REVIEW_PROMPT, type AiProvider, type Config, type Effort, type Prompt } from "@/lib/config";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Group, Intro, Pane, radioKeys, Row } from "./Form";
import { confirmRemove } from "@/lib/confirm";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1">
      <code className="selectable rounded-[4px] bg-fill px-1.5 py-0.5 font-mono text-callout">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("settings.copyNamed", { command })}
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
  const projectId = useId();
  const autoId = useId();
  const reviewPromptId = useId();
  const [models, setModels] = useState<string[]>([]);
  const t = useT();
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
    <Pane title={t("settings.pane.ai")} hero="ai">
      <Intro>{t("settings.aiIntro")}</Intro>

      <Group
        title={t("settings.codingAgent")}
        accessory={
          <Button variant="outline" size="xs" onClick={() => void check()} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("settings.checkAgain")}
          </Button>
        }
        footer={t("settings.checkAgainFooter")}
      >
        <div role="radiogroup" aria-label={t("settings.pane.ai")} className="contents" onKeyDown={radioKeys}>
          {[null, ...AI_PROVIDERS].map((provider) => {
            const status = provider ? statuses?.find((s) => s.provider === provider) : null;
            const active = selected === provider;
            return (
              <div key={provider ?? "none"} className="flex items-start gap-2.5 px-3 py-2.5">
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => choose(provider)}
                  className="group flex min-w-0 flex-1 cursor-default items-start gap-2.5 rounded-(--radius-control-sm) text-left outline-none focus-ring"
                >
                  {/* A radio button as AppKit draws one: the field's well and edge, the accent once picked. */}
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border border-input bg-(--field-bg)", active && "border-transparent bg-primary")} aria-hidden>
                    {active ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
                  </span>
                  <span className="text-body">{provider ? PROVIDERS[provider].name : t("settings.noAi")}</span>
                </button>
                <p className="max-w-[60%] pt-px text-right text-subheadline text-muted-foreground">
                  {!provider ? (
                    t("settings.worksWithout")
                  ) : !statuses ? (
                    t("settings.checking")
                  ) : !status?.installed ? (
                    <>
                      {t("settings.notInstalled")}{" "}
                      <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void bridge.openUrl(PROVIDERS[provider].install)}>
                        {t("settings.getIt")} <ExternalLink />
                      </Button>
                    </>
                  ) : status.signed_in ? (
                    <span className="text-success">{t("settings.ready", { version: status.version ?? "" })}</span>
                  ) : (
                    <>
                      {t("settings.notSignedInRun")} <CopyCommand command={status.login_command} />
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </Group>

      {selected ? (
        <>
          <Group>
            <Row label={t("settings.model")} htmlFor={modelId} description={t("settings.modelHint", { provider: PROVIDERS[selected].name })}>
              <Input
                id={modelId}
                list={`${modelId}-list`}
                className="w-60 font-mono text-callout"
                spellCheck={false}
                autoComplete="off"
                value={ai.model}
                onChange={(e) => setAi({ model: e.target.value })}
                placeholder={t("settings.modelPlaceholder", { provider: PROVIDERS[selected].name })}
              />
              <datalist id={`${modelId}-list`}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Row>
            {PROVIDERS[selected].efforts.length ? (
              <Row label={t("settings.effort")} htmlFor={effortId} description={t("settings.effortHint")}>
                <Select value={ai.effort} onValueChange={(v) => setAi({ effort: (v ?? "") as Effort | "" })} items={PROVIDERS[selected].efforts.map((e) => ({ value: e, label: t(`config.effort.${e}`) }))}>
                  <SelectTrigger id={effortId} className="w-40">
                    <SelectValue>{(v: Effort | "") => t(`config.effort.${v}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS[selected].efforts.map((e) => (
                      <SelectItem key={e} value={e}>
                        {t(`config.effort.${e}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            ) : (
              <Row label={t("settings.effort")} description={t("settings.effortInModel")} />
            )}
          </Group>

          <Group>
            <Row
              label={t("settings.project")}
              htmlFor={projectId}
              description={t("settings.projectHint")}
            >
              <Switch id={projectId} size="sm" checked={ai.project} onCheckedChange={(project) => setAi({ project })} />
            </Row>
          </Group>

          <Group>
            <Row
              label={t("settings.autoReview")}
              htmlFor={autoId}
              description={t("settings.autoReviewHint")}
            >
              <Switch id={autoId} size="sm" checked={ai.review.auto} onCheckedChange={(auto) => setAi({ review: { ...ai.review, auto } })} />
            </Row>
            <Row stacked>
              <div className="flex items-center gap-2">
                <label htmlFor={reviewPromptId} className="text-body">
                  {t("settings.reviewLooksFor")}
                </label>
                {ai.review.prompt !== REVIEW_PROMPT ? (
                  <Button variant="link" size="xs" className="ml-auto h-auto p-0" onClick={() => setAi({ review: { ...ai.review, prompt: REVIEW_PROMPT } })}>
                    {t("settings.restoreDefault")}
                  </Button>
                ) : null}
              </div>
              <Textarea id={reviewPromptId} className="min-h-20" maxLength={8000} value={ai.review.prompt} onChange={(e) => setAi({ review: { ...ai.review, prompt: e.target.value } })} />
            </Row>
          </Group>

          <Group title={<label htmlFor={guidelinesId}>{t("settings.guidelines")}</label>}>
            <Row stacked>
              <Textarea
                id={guidelinesId}
                className="min-h-20"
                value={ai.instructions}
                maxLength={4000}
                onChange={(e) => setAi({ instructions: e.target.value })}
                placeholder={t("settings.guidelinesPlaceholder")}
              />
            </Row>
          </Group>

          <Group
            title={t("settings.prompts")}
            accessory={
              <Button variant="link" size="xs" className="h-auto p-0" onClick={() => setPrompts(defaultPrompts())}>
                {t("settings.restoreDefaults")}
              </Button>
            }
            footer={t("settings.promptsFooter")}
          >
            {ai.prompts.map((p, i) => (
              <Row stacked key={p.id}>
                <div className="flex items-center gap-1">
                  <Input aria-label={t("settings.buttonName")} className="max-w-52" maxLength={30} value={p.name} onChange={(e) => updatePrompt(p.id, { name: e.target.value })} />
                  <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={t("settings.moveNamedUp", { name: p.name })} disabled={i === 0} onClick={() => movePrompt(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t("settings.moveNamedDown", { name: p.name })} disabled={i === ai.prompts.length - 1} onClick={() => movePrompt(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label={t("settings.removeNamed", { name: p.name })} onClick={async () => (await confirmRemove(t("settings.removePromptConfirm", { name: p.name }))) && setPrompts(ai.prompts.filter((x) => x.id !== p.id))}>
                    <Trash2 />
                  </Button>
                </div>
                <Textarea aria-label={t("settings.whatAsks", { name: p.name })} className="min-h-16" maxLength={8000} value={p.prompt} onChange={(e) => updatePrompt(p.id, { prompt: e.target.value })} />
              </Row>
            ))}
            <div className="px-3 py-2">
              <Button
                variant="outline"
                size="xs"
                disabled={ai.prompts.length >= 12}
                onClick={() => setPrompts([...ai.prompts, { id: newId(), name: t("settings.newPrompt"), prompt: "What should I ask the author before approving?" }])}
              >
                <Plus /> {t("settings.addPrompt")}
              </Button>
            </div>
          </Group>
        </>
      ) : null}
    </Pane>
  );
}
