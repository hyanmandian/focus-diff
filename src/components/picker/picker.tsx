// A picker as a Mac popover: a search field over a list of choices with checkmarks, each change
// made as it's clicked (GitHub's own pickers apply when they close; here nothing waits). The
// arrows move through the list from the field, Return picks, Esc closes. What was chosen when it
// opened stays at the top while it's open, so rows don't jump under the pointer.

import { Check, Loader2, Search } from "lucide-react";
import { useId, useState, type ReactElement, type ReactNode } from "react";

import { Input } from "@/components/input/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/popover/popover";
import { cn } from "@/utils/cn/cn";

export type Choice = { id: string; label: string; detail?: string | null; leading?: ReactNode; selected: boolean };

type Props = {
  title: string;
  placeholder: string;
  /** What shows when nothing matches. */
  empty: string;
  choices: Choice[];
  onPick: (choice: Choice) => void;
  /** The trigger, as Base UI's render prop takes it. */
  trigger: ReactElement;
  children: ReactNode;
  /** Typed into the search field: for choices beyond those loaded (people past the first hundred). */
  onQuery?: (query: string) => void;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Picker({
  title,
  placeholder,
  empty,
  choices,
  onPick,
  trigger,
  children,
  onQuery,
  loading,
  open: controlled,
  onOpenChange,
}: Props) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Chosen when it opened: these lead the list until it closes.
  const [first, setFirst] = useState<Set<string>>(() => new Set());
  const list = useId();
  const setOpen = (next: boolean) => {
    if (next) {
      setFirst(new Set(choices.filter((c) => c.selected).map((c) => c.id)));
      setQuery("");
      setActive(0);
    }
    setOwn(next);
    onOpenChange?.(next);
  };
  const q = query.trim().toLowerCase();
  const shown = choices
    .filter((c) => !q || c.label.toLowerCase().includes(q) || c.detail?.toLowerCase().includes(q))
    .sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)));
  const at = Math.min(active, Math.max(0, shown.length - 1));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-2 p-2">
        <PopoverTitle className="px-1.5 pt-0.5 text-subheadline font-semibold text-muted-foreground">
          {title}
        </PopoverTitle>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            autoFocus
            type="search"
            value={query}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded
            aria-controls={list}
            aria-activedescendant={shown[at] ? `${list}-${at}` : undefined}
            className="rounded-full pl-7 [&::-webkit-search-cancel-button]:appearance-none"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              onQuery?.(e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
              } else if (e.key === "Enter" && shown[at]) {
                e.preventDefault();
                onPick(shown[at]);
              }
            }}
          />
          {loading ? (
            <Loader2
              className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </div>
        <ul
          id={list}
          role="listbox"
          aria-multiselectable
          aria-label={title}
          className="-mx-0.5 max-h-72 overflow-y-auto overscroll-contain"
        >
          {shown.length ? (
            shown.map((c, i) => (
              <li
                key={c.id}
                id={`${list}-${i}`}
                role="option"
                aria-selected={c.selected}
                onMouseMove={() => setActive(i)}
                onClick={() => onPick(c)}
                className={cn(
                  "flex min-h-(--menu-item-h) cursor-default items-center gap-2 rounded-(--radius-menu-item) px-1.5 py-1 text-body",
                  i === at && "bg-(--selection-bg) text-(--selection-fg) **:text-(--selection-fg)",
                )}
              >
                <Check className={cn("size-3.5 shrink-0", !c.selected && "invisible")} aria-hidden />
                {c.leading}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.label}</span>
                  {c.detail ? (
                    <span className="block truncate text-subheadline text-muted-foreground">{c.detail}</span>
                  ) : null}
                </span>
              </li>
            ))
          ) : (
            <li className="px-1.5 py-2 text-callout text-muted-foreground">{loading ? "…" : empty}</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
