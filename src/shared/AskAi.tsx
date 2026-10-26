// Asking the person's AI about a pull request: their saved prompts as buttons, or a question of
// their own. Shown only when they've chosen an AI in Settings.

import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ask, PROVIDERS } from "@/lib/ai";
import { ensureAi, openAiSettings, useAiProblem } from "@/lib/aiReady";
import type { Config } from "@/lib/config";
import type { Details } from "@/lib/details";
import { useT } from "@/lib/i18n";
import { AiAnswer } from "./AiAnswer";

type State = { phase: "idle" } | { phase: "busy"; asked: string } | { phase: "done" | "error"; asked: string; text: string; note?: string };

export function AskAi({ config, details }: { config: Config; details: Details }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [question, setQuestion] = useState("");
  const headingId = useId();
  const t = useT();
  const problem = useAiProblem(config);
  const provider = config.ai.provider;
  if (!provider) return null;
  const busy = state.phase === "busy";

  const run = async (asked: string, prompt: string) => {
    if (!(await ensureAi(config))) return;
    setState({ phase: "busy", asked });
    try {
      const answer = await ask(config, details, prompt);
      setState({ phase: "done", asked, text: answer.text, note: answer.note });
    } catch (e) {
      setState({ phase: "error", asked, text: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    // Kept in the field when the AI can't take it, to send once it's set up.
    void ensureAi(config).then((ok) => {
      if (!ok) return;
      setQuestion("");
      void run(q, q);
    });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5 rounded-xl border bg-muted/40 p-3" aria-busy={busy}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-violet" aria-hidden />
        <h3 id={headingId} className="text-headline font-bold">
          {t("shared.askTitle", { provider: PROVIDERS[provider].name })}
        </h3>
        {busy ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label={t("shared.askThinking")} /> : null}
      </div>
      {/* Said before anything's asked, with the way to fix it: asking would only end in the same alert. */}
      {problem ? (
        <p className="flex flex-wrap items-center gap-x-2 text-callout text-muted-foreground">
          {t("shared.aiNotReady", { provider: PROVIDERS[provider].name })}
          <Button variant="link" size="xs" className="h-auto p-0" onClick={() => void openAiSettings()}>
            {t("shared.aiOpenSettings")}
          </Button>
        </p>
      ) : null}
      {config.ai.prompts.length ? (
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
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("shared.askPlaceholder")}
          aria-label={t("shared.askLabel", { provider: PROVIDERS[provider].name })}
          maxLength={2000}
        />
        <Button type="submit" size="icon-sm" variant="secondary" disabled={busy || !question.trim()} aria-label={t("shared.askSubmit")}>
          <ArrowUp />
        </Button>
      </form>
      {state.phase !== "idle" ? (
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
            <p className="text-callout text-muted-foreground">{config.ai.project ? t("shared.askReadingProject") : t("shared.askReadingDiff")}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
