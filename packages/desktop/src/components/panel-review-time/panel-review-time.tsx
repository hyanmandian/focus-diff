import { Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { bridge } from "@/utils/bridge/bridge";
import type { Item } from "@/utils/engine/engine";
import { useT } from "@/utils/i18n/i18n";
import { markSeen, type ReviewRun, type RunPull } from "@/utils/store/store";

const minutesLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 60_000));

export function ReviewTime({ review, items }: { review: ReviewRun; items: Record<string, Item[]> }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const { run, endsAt } = review;
  const left = minutesLeft(endsAt, now);

  const open = (pull: RunPull) => {
    const item = Object.values(items)
      .flat()
      .find((i) => i.pr.id === pull.id);
    if (item) markSeen(item);
    void bridge.openReview(
      item?.pr ?? {
        id: pull.id,
        number: pull.number,
        title: pull.title,
        repository: { nameWithOwner: pull.repo },
        author: null,
      },
      item?.viaTeams ?? [],
      undefined,
      item?.queueId,
    );
  };

  return (
    <section aria-label={run.name} className="mx-4 mb-2 shrink-0 rounded-[8px] bg-(--panel-fill) px-3 py-2">
      <div className="flex items-center gap-1.5 text-callout">
        <Timer className="size-3.5 shrink-0 text-success" aria-hidden />
        <span className="min-w-0 truncate font-semibold">{run.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums" role="timer" aria-live="off">
          {t("panel.minutesLeft", { minutes: left })}
        </span>
        <button
          type="button"
          className="ml-auto shrink-0 cursor-default rounded-sm font-medium text-(--panel-link) underline-offset-2 focus-ring outline-none hover:underline"
          onClick={() => void bridge.endReview()}
        >
          {t("panel.end")}
        </button>
      </div>
      <ol className="-mx-1.5 mt-1 flex flex-col">
        {run.pulls.map((pull) => (
          <li key={pull.id}>
            <button
              type="button"
              onClick={() => {
                open(pull);
              }}
              className="flex w-full cursor-default items-baseline gap-2 rounded-[5px] px-1.5 py-0.5 text-left text-callout outline-none hover:bg-foreground/5 focus-visible:bg-(--selection-bg) focus-visible:text-(--selection-fg) focus-visible:**:text-(--selection-fg) active:bg-foreground/9"
            >
              <span className="min-w-0 flex-1 truncate">{pull.title}</span>
              {pull.again ? <span className="shrink-0 text-warning">{t("panel.reReview")}</span> : null}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t("common.aboutMinutes", { minutes: pull.minutes })}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
