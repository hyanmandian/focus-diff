// Asking the person's AI about a pull request: their saved prompts as buttons, or a question of
// their own. Shown only when they've chosen an AI in Settings.

import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ask, PROVIDERS } from "@/lib/ai";
import type { Config } from "@/lib/config";
import type { Details } from "@/lib/details";
import { AiAnswer } from "./AiAnswer";

type State = { phase: "idle" } | { phase: "busy"; asked: string } | { phase: "done" | "error"; asked: string; text: string };

export function AskAi({ config, details }: { config: Config; details: Details }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [question, setQuestion] = useState("");
  const headingId = useId();
  const provider = config.ai.provider;
  if (!provider) return null;
  const busy = state.phase === "busy";

  const run = async (asked: string, prompt: string) => {
    setState({ phase: "busy", asked });
    try {
      setState({ phase: "done", asked, text: await ask(config, details, prompt) });
    } catch (e) {
      setState({ phase: "error", asked, text: typeof e === "string" ? e : e instanceof Error ? e.message : String(e) });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    void run(q, q);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5 rounded-xl border bg-muted/40 p-3" aria-busy={busy}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-violet" aria-hidden />
        <h3 id={headingId} className="text-xs font-semibold">
          Ask {PROVIDERS[provider].name}
        </h3>
        {busy ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Thinking" /> : null}
      </div>
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
          placeholder="Ask about this pull request…"
          aria-label={`Ask ${PROVIDERS[provider].name} about this pull request`}
          className="h-7 text-xs"
          maxLength={2000}
        />
        <Button type="submit" size="icon-xs" variant="secondary" disabled={busy || !question.trim()} aria-label="Ask">
          <ArrowUp />
        </Button>
      </form>
      {state.phase !== "idle" ? (
        <div className="flex flex-col gap-1.5 border-t pt-2.5" aria-live="polite">
          <p className="line-clamp-2 text-[11px] font-medium text-muted-foreground">{state.asked}</p>
          {state.phase === "done" ? (
            <AiAnswer text={state.text} />
          ) : state.phase === "error" ? (
            <p className="text-xs text-destructive" role="alert">
              {state.text}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Reading the diff… this can take a minute.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
