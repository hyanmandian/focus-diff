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
        data-slot="tag-input"
        // A text field (components/ui/input) that holds its values as tokens, as AppKit's token
        // field does: the field's well and edge, 24pt tall until it wraps, the focus ring around it.
        className={cn(
          "flex min-h-(--field-h) flex-wrap items-center gap-[3px] rounded-(--radius-field) border border-input bg-(--field-bg) px-[3px] py-[2px]",
          "focus-within:outline-3 focus-within:outline-(--focus-ring)",
          error && "border-destructive",
        )}
      >
        {value.map((v) => (
          <span key={v} className="inline-flex h-[18px] items-center gap-0.5 rounded-[4px] bg-fill pr-px pl-1.5 font-mono text-subheadline">
            {v}
            <button
              type="button"
              className="grid size-4 cursor-default place-items-center rounded-[3px] text-muted-foreground outline-none focus-ring active:bg-(--fill-control-pressed)"
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
          className="h-[18px] min-w-32 flex-1 bg-transparent px-1 text-body caret-primary outline-none placeholder:text-muted-foreground"
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
        <p id={errorId} className="text-subheadline text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
