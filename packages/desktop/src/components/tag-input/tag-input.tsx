import { X } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  validate?: ((value: string) => string | null) | undefined;
  label: string;
};

export function TagInput({ value, onChange, placeholder, validate, label }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const t = useT();

  const add = (raw: string) => {
    const next = raw.trim().replace(/,$/u, "");
    if (!next) return;
    const problem = validate?.(next) ?? (value.includes(next) ? t("settings.alreadyAdded") : null);
    if (problem) {
      setError(problem);
      return;
    }
    onChange([...value, next]);
    setDraft("");
    setError(null);
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        data-slot="tag-input"
        className={cn(
          "flex min-h-(--field-h) flex-wrap items-center gap-1 rounded-(--radius-field) field px-1 py-0.5",
          error && "border-destructive",
        )}
      >
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex h-[22px] items-center gap-0.5 rounded-[5px] bg-fill pr-0.5 pl-1.5 font-mono text-subheadline"
          >
            {v}
            <button
              type="button"
              className="grid size-[18px] cursor-default place-items-center rounded-[4px] text-muted-foreground focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-(--fill-control-hover) hover:text-foreground active:bg-(--fill-control-pressed)"
              aria-label={t("settings.removeNamed", { name: v })}
              onClick={() => {
                onChange(value.filter((x) => x !== v));
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="h-[22px] min-w-32 flex-1 bg-transparent px-1 text-body caret-primary outline-none placeholder:text-muted-foreground"
          placeholder={value.length > 0 ? "" : placeholder}
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
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            add(draft);
          }}
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
