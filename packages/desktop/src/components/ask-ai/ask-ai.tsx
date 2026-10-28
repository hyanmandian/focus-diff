import { ArrowUp, Loader2, Sparkles, Square } from "lucide-react";
import { useId, useState, type SubmitEvent } from "react";

import { AiAnswer } from "@/components/ai-answer/ai-answer";
import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { useSeconds } from "@/hooks/use-seconds/use-seconds";
import { ensureAi, openAiSettings, useAiProblem } from "@/utils/ai-ready/ai-ready";
import { ask, newRun, PROVIDERS } from "@/utils/ai/ai";
import { bridge } from "@/utils/bridge/bridge";
import type { Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import { errorText } from "@/utils/error/error";
import { useT } from "@/utils/i18n/i18n";

type State =
  | { phase: "idle" }
  | { phase: "busy"; asked: string; run: string; at: number }
  | { phase: "done" | "error"; asked: string; text: string; note?: string };

export function AskAi({ config, details }: { config: Config; details: Details }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [question, setQuestion] = useState("");
  const headingId = useId();
  const t = useT();
  const problem = useAiProblem(config);
  const waited = useSeconds(state.phase === "busy" ? state.at : null);
  const provider = config.ai.provider;
  if (!provider) return null;
  const busy = state.phase === "busy";

  const askNow = async (asked: string, prompt: string) => {
    const id = newRun();
    // oxlint-disable-next-line react/purity
    setState({ phase: "busy", asked, run: id, at: Date.now() });
    try {
      const answer = await ask(config, details, prompt, id);
      setState({ phase: "done", asked, text: answer.text, note: answer.note });
    } catch (e) {
      setState({ phase: "error", asked, text: errorText(e) });
    }
  };
  const run = async (asked: string, prompt: string) => {
    if (await ensureAi(config)) await askNow(asked, prompt);
  };
  const send = async (q: string) => {
    if (!(await ensureAi(config))) return;
    setQuestion("");
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
        {state.phase === "busy" ? (
          <Button variant="outline" size="xs" className="ml-auto" onClick={() => void bridge.aiCancel(state.run)}>
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
      {state.phase === "idle" ? null : (
        <div className="flex flex-col gap-1.5 border-t pt-2.5" aria-live="polite">
          <p className="line-clamp-2 text-subheadline font-medium text-muted-foreground">{state.asked}</p>
          {state.phase === "done" ? (
            <>
              <AiAnswer text={state.text} />
              {state.note ? <p className="text-subheadline text-muted-foreground">{state.note}</p> : null}
            </>
          ) : state.phase === "error" ? (
            <p className="text-callout text-destructive" role="alert">
              {state.text}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-callout text-muted-foreground tabular-nums">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {config.ai.project ? t("shared.askReadingProject") : t("shared.askReadingDiff")}
              {waited >= 3 ? (
                <span aria-hidden> · {t("review.waitedSeconds", { seconds: String(waited) })}</span>
              ) : null}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
