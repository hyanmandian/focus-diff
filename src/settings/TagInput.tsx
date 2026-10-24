// A list of short values (repositories, teams, labels, people) typed one by one: Enter or comma
// adds, Backspace on an empty field removes the last, each has a remove button.

import { X } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Returns an error for a value that can't be added. */
  validate?: (value: string) => string | null;
  label: string;
};

export function TagInput({ value, onChange, placeholder, validate, label }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const add = (raw: string) => {
    const next = raw.trim().replace(/,$/, "");
    if (!next) return;
    const problem = validate?.(next) ?? (value.includes(next) ? "Already added" : null);
    if (problem) return setError(problem);
    onChange([...value, next]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-transparent px-1.5 py-1 transition-colors",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 dark:bg-input/30",
          error && "border-destructive",
        )}
      >
        {value.map((v) => (
          <span key={v} className="inline-flex h-6 items-center gap-1 rounded-md bg-muted pr-0.5 pl-2 font-mono text-xs">
            {v}
            <button
              type="button"
              className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="h-6 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={value.length ? "" : placeholder}
          value={draft}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => {
            setError(null);
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => add(draft)}
        />
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
