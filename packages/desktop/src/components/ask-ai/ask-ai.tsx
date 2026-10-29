import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";
import { useId, useState, type SubmitEvent } from "react";

import { AiAnswer } from "@/components/ai-answer/ai-answer";
import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { useSeconds } from "@/hooks/use-seconds/use-seconds";
import { ensureAi, openAiSettings, useAiProblem } from "@/utils/ai-ready/ai-ready";
import { ask, newRun, PROVIDERS } from "@/utils/ai/ai";
import { askInto, BLANK, updateChat, usePullAsking } from "@/utils/asking/asking";
import { bridge } from "@/utils/bridge/bridge";
import type { Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import { useT } from "@/utils/i18n/i18n";

const KEY = "overview";

export function AskAi({ config, details }: { config: Config; details: Details }) {
  const chat = usePullAsking(details.id).chats[KEY] ?? BLANK;
  const [asked, setAsked] = useState("");
  const { question, run: running, error } = chat;
  const last = chat.turns.at(-1);
  const headingId = useId();
  const t = useT();
  const problem = useAiProblem(config);
  const waited = useSeconds(running?.at ?? null);
  const provider = config.ai.provider;
  if (!provider) return null;
  const busy = Boolean(running);
  const setQuestion = (next: string) => {
    updateChat(details.id, KEY, { question: next });
  };

  const askNow = async (title: string, prompt: string) => {
    setAsked(title);
    updateChat(details.id, KEY, { turns: [] });
    const id = newRun();
    const answered = await askInto(details.id, KEY, title, id, () => ask(config, details, prompt, id));
    if (!answered && title !== prompt)
      updateChat(details.id, KEY, (c) => (c.question === title ? { question: "" } : {}));
  };
  const run = async (title: string, prompt: string) => {
    if (await ensureAi(config)) await askNow(title, prompt);
  };
  const send = async (q: string) => {
    if (!(await ensureAi(config))) return;
    await askNow(q, q);
  };
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    void send(q);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5 rounded-xl border bg-muted/40 p-3"
      aria-busy={busy}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-violet" aria-hidden />
        <h3 id={headingId} className="text-headline font-bold">
          {t("shared.askTitle", { provider: PROVIDERS[provider].name })}
        </h3>
        {running ? (
          <Button variant="outline" size="xs" className="ml-auto" onClick={() => void bridge.aiCancel(running.id)}>
            <Square className="size-2.5 fill-current" /> {t("review.stop")}
          </Button>
        ) : null}
      </div>
      {problem ? (
        <p className="flex flex-wrap items-center gap-x-2 text-callout text-muted-foreground">
          {t("shared.aiNotReady", { provider: PROVIDERS[provider].name })}
          <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void openAiSettings()}>
            {t("shared.aiOpenSettings")}
          </Button>
        </p>
      ) : null}
      {config.ai.prompts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {config.ai.prompts.map((p) => (
            <Button key={p.id} variant="outline" size="xs" disabled={busy} onClick={() => void run(p.name, p.prompt)}>
              {p.name}
            </Button>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <Input
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          placeholder={t("shared.askPlaceholder")}
          aria-label={t("shared.askLabel", { provider: PROVIDERS[provider].name })}
          maxLength={2000}
        />
        <Button
          type="submit"
          size="icon-sm"
          variant="secondary"
          disabled={busy || !question.trim()}
          aria-label={t("shared.askSubmit")}
        >
          <ArrowUp />
        </Button>
      </form>
      {!last && !error ? null : (
        <div className="flex flex-col gap-1.5 border-t pt-2.5" aria-live="polite">
          <p className="line-clamp-2 text-subheadline font-medium text-muted-foreground">{last?.question ?? asked}</p>
          {last?.answer === undefined ? (
            error ? (
              <p className="text-callout text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-callout text-muted-foreground tabular-nums">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                {config.ai.project ? t("shared.askReadingProject") : t("shared.askReadingDiff")}
                {waited >= 3 ? (
                  <span aria-hidden> · {t("review.waitedSeconds", { seconds: String(waited) })}</span>
                ) : null}
              </p>
            )
          ) : (
            <>
              <AiAnswer text={last.answer} />
              {last.note ? <p className="text-subheadline text-muted-foreground">{last.note}</p> : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}
