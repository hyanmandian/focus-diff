// The stack this pull request is in, at the top of the overview: every pull request of it from the
// bottom up, joined by a line, with how each one's review stands, this one marked and the others a
// click away (in this window, as the toolbar's menu).

import { Layers } from "lucide-react";

import type { Stack } from "@/hooks/use-stack/use-stack";
import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";
import type { StackPull } from "@/utils/stack/stack";

/** How each one's review stands, as a coloured word after its title. */
const STANDING = {
  APPROVED: "text-success",
  CHANGES_REQUESTED: "text-destructive",
  REVIEW_REQUIRED: "text-muted-foreground",
} as const;

export function StackCard({ stack, onPick }: { stack: Stack; onPick: (pull: StackPull) => void }) {
  const t = useT();
  const last = stack.pulls.length - 1;
  return (
    <section aria-labelledby="stack" className="rounded-xl border bg-card p-2">
      <h2
        id="stack"
        className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5 text-callout leading-[18px] font-semibold text-muted-foreground"
      >
        <Layers className="size-3.5" aria-hidden />
        {t("review.stack")}
        <span className="font-normal tabular-nums">
          {t("review.stackPosition", { index: String(stack.at + 1), total: String(stack.pulls.length) })}
        </span>
      </h2>
      <ol>
        {stack.pulls.map((pull, i) => {
          const here = i === stack.at;
          const standing = pull.decision ?? "REVIEW_REQUIRED";
          const body = (
            <>
              {/* The line through the stack, and this one's dot on it. */}
              <span className="relative flex w-4 shrink-0 justify-center self-stretch" aria-hidden>
                {i > 0 ? <span className="absolute top-0 h-1/2 w-0.5 bg-foreground/15" /> : null}
                {i < last ? <span className="absolute top-1/2 bottom-0 w-0.5 bg-foreground/15" /> : null}
                <span
                  className={cn(
                    "relative mt-[11px] size-2.5 rounded-full border-2",
                    here ? "border-primary bg-primary" : "border-foreground/30 bg-card",
                  )}
                />
              </span>
              <span className="min-w-0 flex-1 truncate py-1.5">
                <span className="text-muted-foreground tabular-nums">#{pull.number}</span>{" "}
                <span className={cn(here && "font-semibold")}>{pull.title}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 py-1.5 text-subheadline",
                  pull.isDraft ? "text-muted-foreground" : STANDING[standing],
                )}
              >
                {pull.isDraft ? t("review.stackDraft") : t(`review.stackStanding.${standing}`)}
              </span>
            </>
          );
          return (
            <li key={pull.id}>
              {here ? (
                <div
                  aria-current="page"
                  className="flex items-start gap-2.5 rounded-[8px] bg-primary/8 px-2.5 text-body"
                >
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onPick(pull);
                  }}
                  className="flex w-full cursor-default items-start gap-2.5 rounded-[8px] px-2.5 text-left text-body focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-(--fill-control-hover)"
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
