import { ChevronDown, ChevronUp, X } from "lucide-react";

import { Button } from "@/components/button/button";
import { Input } from "@/components/input/input";
import { useT } from "@/utils/i18n/i18n";

type Props = {
  query: string;
  total: number;
  at: number;
  onQuery: (query: string) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
};

export function FindBar({ query, total, at, onQuery, onStep, onClose }: Props) {
  const t = useT();
  const status = query.trim() ? (total ? t("review.findAt", { index: at + 1, total }) : t("review.findNone")) : "";
  return (
    <search
      aria-label={t("review.findInDiff")}
      className="absolute top-2 right-3 z-30 flex items-center gap-1 rounded-[10px] border bg-popover p-1 text-popover-foreground shadow-(--shadow-menu)"
    >
      <Input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by Cmd-F to type in at once, as every find bar
        autoFocus
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        type="search"
        value={query}
        aria-label={t("review.findInDiff")}
        placeholder={t("review.findPlaceholder")}
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-56 [&::-webkit-search-cancel-button]:appearance-none"
        onChange={(e) => {
          onQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onStep(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <output aria-live="polite" className="min-w-16 px-1 text-center text-callout text-muted-foreground tabular-nums">
        {status}
      </output>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("review.findPrevious")}
        disabled={!total}
        onClick={() => {
          onStep(-1);
        }}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("review.findNext")}
        disabled={!total}
        onClick={() => {
          onStep(1);
        }}
      >
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t("review.findClose")} onClick={onClose}>
        <X />
      </Button>
    </search>
  );
}
