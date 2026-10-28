import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/select/select";
import { Group, Intro, moved, Pane, radioKeys, Row } from "@/components/settings-form/settings-form";
import { Switch } from "@/components/switch/switch";
import { Textarea } from "@/components/textarea/textarea";
import { PROVIDERS } from "@/utils/ai/ai";
import { bridge, type AiStatus } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import {
  AI_PROVIDERS,
  defaultPrompts,
  newId,
  REVIEW_PROMPT,
  type AiProvider,
  type Config,
  type Effort,
  type Prompt,
} from "@/utils/config/config";
import { confirmRemove } from "@/utils/confirm/confirm";
import { useT } from "@/utils/i18n/i18n";

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <code className="selectable rounded-[4px] bg-fill px-1.5 py-0.5 font-mono text-callout">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("settings.copyNamed", { command })}
        onClick={() => {
          void copy();
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </span>
  );
}

export function Ai({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const [statuses, setStatuses] = useState<AiStatus[] | null>(null);
  const [checking, setChecking] = useState(true);
  const modelId = useId();
  const effortId = useId();
  const guidelinesId = useId();
  const projectId = useId();
  const autoId = useId();
  const reviewPromptId = useId();
  const [offered, setOffered] = useState<{ provider: AiProvider; models: string[] } | null>(null);
  const t = useT();
  const load = useCallback(async () => {
    try {
      setStatuses(await bridge.aiStatuses());
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const check = () => {
    setChecking(true);
    void load();
  };

  const selected = config.ai.provider;
  const ai = config.ai;
  const setAi = (patch: Partial<Config["ai"]>) => {
    onChange({ ...config, ai: { ...ai, ...patch } });
  };
  const choose = (provider: AiProvider | null) => {
    setAi(provider === ai.provider ? {} : { provider, model: "", effort: "" });
  };
  useEffect(() => {
    if (!selected) return;
    const ask = async () => {
      let models: string[] = [];
      try {
        models = await bridge.aiModels(selected);
      } catch {}
      setOffered({ provider: selected, models });
    };
    void ask();
  }, [selected]);
  const models = offered && offered.provider === selected ? offered.models : [];
  const setPrompts = (prompts: Prompt[]) => {
    setAi({ prompts });
  };
  const updatePrompt = (id: string, patch: Partial<Prompt>) => {
    setPrompts(ai.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const movePrompt = (index: number, by: number) => {
    setPrompts(moved(ai.prompts, index, by));
  };
  const removePrompt = async (prompt: Prompt) => {
    if (await confirmRemove(t("settings.removePromptConfirm", { name: prompt.name })))
      setPrompts(ai.prompts.filter((x) => x.id !== prompt.id));
  };

  return (
    <Pane title={t("settings.pane.ai")} hero="ai">
      <Intro>{t("settings.aiIntro")}</Intro>

      <Group
        title={t("settings.codingAgent")}
        accessory={
          <Button variant="outline" onClick={check} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t("settings.checkAgain")}
          </Button>
        }
        footer={t("settings.checkAgainFooter")}
      >
        {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- see above */}
        <div role="radiogroup" aria-label={t("settings.pane.ai")} className="contents" onKeyDown={radioKeys}>
          {[null, ...AI_PROVIDERS].map((provider) => {
            const status = provider ? statuses?.find((s) => s.provider === provider) : null;
            const active = selected === provider;
            return (
              <div key={provider ?? "none"} className="flex items-start gap-2.5 px-3 py-2.5">
                <button
                  type="button"
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a radio drawn as AppKit's, with the roving focus above
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    choose(provider);
                  }}
                  className="group flex min-w-0 flex-1 cursor-default items-start gap-2.5 rounded-(--radius-control-sm) text-left focus-ring outline-none"
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border border-input bg-(--field-bg) transition-colors duration-(--duration-fast) group-hover:border-(--field-border-hover)",
                      active && "border-transparent bg-primary",
                    )}
                    aria-hidden
                  >
                    {active ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
                  </span>
                  <span className="text-body">{provider ? PROVIDERS[provider].name : t("settings.noAi")}</span>
                </button>
                <p className="max-w-[60%] pt-px text-right text-subheadline text-muted-foreground">
                  {provider ? (
                    statuses ? (
                      status?.installed ? (
                        status.signed_in ? (
                          <span className="text-success">{t("settings.ready", { version: status.version ?? "" })}</span>
                        ) : (
                          <>
                            {t("settings.notSignedInRun")} <CopyCommand command={status.login_command} />
                          </>
                        )
                      ) : (
                        <>
                          {t("settings.notInstalled")}{" "}
                          <Button
                            variant="link"
                            size="xs"
                            className="h-auto p-0"
                            onClick={() => void bridge.openUrl(PROVIDERS[provider].install)}
                          >
                            {t("settings.getIt")} <ExternalLink />
                          </Button>
                        </>
                      )
                    ) : (
                      t("settings.checking")
                    )
                  ) : (
                    t("settings.worksWithout")
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
            <Row
              label={t("settings.model")}
              htmlFor={modelId}
              description={t("settings.modelHint", { provider: PROVIDERS[selected].name })}
            >
              <Input
                id={modelId}
                list={`${modelId}-list`}
                className="w-60 font-mono text-callout"
                spellCheck={false}
                autoComplete="off"
                value={ai.model}
                onChange={(e) => {
                  setAi({ model: e.target.value });
                }}
                placeholder={t("settings.modelPlaceholder", { provider: PROVIDERS[selected].name })}
              />
              <datalist id={`${modelId}-list`}>
                {models.map((m) => (
                  <option key={m} value={m} aria-label={m} />
                ))}
              </datalist>
            </Row>
            {PROVIDERS[selected].efforts.length > 0 ? (
              <Row label={t("settings.effort")} htmlFor={effortId} description={t("settings.effortHint")}>
                <Select
                  value={ai.effort}
                  onValueChange={(v) => {
                    setAi({ effort: v! });
                  }}
                  items={PROVIDERS[selected].efforts.map((e) => ({ value: e, label: t(`config.effort.${e}`) }))}
                >
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
            <Row label={t("settings.project")} htmlFor={projectId} description={t("settings.projectHint")}>
              <Switch
                id={projectId}
                size="sm"
                checked={ai.project}
                onCheckedChange={(project) => {
                  setAi({ project });
                }}
              />
            </Row>
          </Group>

          <Group>
            <Row label={t("settings.autoReview")} htmlFor={autoId} description={t("settings.autoReviewHint")}>
              <Switch
                id={autoId}
                size="sm"
                checked={ai.review.auto}
                onCheckedChange={(auto) => {
                  setAi({ review: { ...ai.review, auto } });
                }}
              />
            </Row>
            <Row stacked>
              <div className="flex items-center gap-2">
                <label htmlFor={reviewPromptId} className="text-body">
                  {t("settings.reviewLooksFor")}
                </label>
                {ai.review.prompt === REVIEW_PROMPT ? null : (
                  <Button
                    variant="link"
                    size="xs"
                    className="ml-auto h-auto p-0"
                    onClick={() => {
                      setAi({ review: { ...ai.review, prompt: REVIEW_PROMPT } });
                    }}
                  >
                    {t("settings.restoreDefault")}
                  </Button>
                )}
              </div>
              <Textarea
                id={reviewPromptId}
                className="min-h-20"
                maxLength={8000}
                value={ai.review.prompt}
                onChange={(e) => {
                  setAi({ review: { ...ai.review, prompt: e.target.value } });
                }}
              />
            </Row>
          </Group>

          <Group title={<label htmlFor={guidelinesId}>{t("settings.guidelines")}</label>}>
            <Row stacked>
              <Textarea
                id={guidelinesId}
                className="min-h-20"
                value={ai.instructions}
                maxLength={4000}
                onChange={(e) => {
                  setAi({ instructions: e.target.value });
                }}
                placeholder={t("settings.guidelinesPlaceholder")}
              />
            </Row>
          </Group>

          <Group
            title={t("settings.prompts")}
            accessory={
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0"
                onClick={() => {
                  setPrompts(defaultPrompts());
                }}
              >
                {t("settings.restoreDefaults")}
              </Button>
            }
            footer={t("settings.promptsFooter")}
          >
            {ai.prompts.map((p, i) => (
              <Row stacked key={p.id}>
                <div className="flex items-center gap-1">
                  <Input
                    aria-label={t("settings.buttonName")}
                    className="max-w-52"
                    maxLength={30}
                    value={p.name}
                    onChange={(e) => {
                      updatePrompt(p.id, { name: e.target.value });
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto"
                    aria-label={t("settings.moveNamedUp", { name: p.name })}
                    disabled={i === 0}
                    onClick={() => {
                      movePrompt(i, -1);
                    }}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings.moveNamedDown", { name: p.name })}
                    disabled={i === ai.prompts.length - 1}
                    onClick={() => {
                      movePrompt(i, 1);
                    }}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("settings.removeNamed", { name: p.name })}
                    onClick={() => {
                      void removePrompt(p);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <Textarea
                  aria-label={t("settings.whatAsks", { name: p.name })}
                  className="min-h-16"
                  maxLength={8000}
                  value={p.prompt}
                  onChange={(e) => {
                    updatePrompt(p.id, { prompt: e.target.value });
                  }}
                />
              </Row>
            ))}
            <div className="px-3 py-2">
              <Button
                variant="outline"
                disabled={ai.prompts.length >= 12}
                onClick={() => {
                  setPrompts([
                    ...ai.prompts,
                    {
                      id: newId(),
                      name: t("settings.newPrompt"),
                      prompt: "What should I ask the author before approving?",
                    },
                  ]);
                }}
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
