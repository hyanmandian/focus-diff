import { LINES_PER_HOUR } from "@focus-diff/core/estimate";

import { i18n } from "#i18n";
import { clockIcon, diffIcon, doneIcon, fileIcon } from "@/components/icons/icons";
import { createScoreboard } from "@/components/scoreboard/scoreboard";
import { h } from "@/utils/dom/dom";
import { formatClock, formatDuration, formatNumber as format } from "@/utils/format/format";

export interface Totals {
  visible: number;
  total: number;
  additions: number;
  deletions: number;
  pending: number;
  minutes: number;
  viewed: number;
  minutesLeft: number;
}

export const isDone = (totals: Totals): boolean =>
  totals.visible > 0 && totals.minutesLeft === 0 && totals.pending === 0;

const readOut = () => h("span", { className: "visually-hidden" });

export const createStats = () => {
  const files = createScoreboard("files-count");
  const additions = createScoreboard("additions");
  const deletions = createScoreboard("deletions");
  const time = createScoreboard("time");
  const filesText = readOut();
  const additionsText = readOut();
  const deletionsText = readOut();
  const timeWords = readOut();
  const done = h("span", { className: "done" }, doneIcon(), i18n.t("timeDone"));
  const timeLabel = h("span", { className: "visually-hidden", textContent: ` ${i18n.t("panelTimeLabel")}` });
  const pendingText = readOut();
  const filesGroup = h("span", { className: "stat files" }, fileIcon(), files.element, filesText);
  const element = h(
    "span",
    { className: "stats" },
    filesGroup,
    h(
      "span",
      { className: "stat lines" },
      diffIcon(),
      additions.element,
      additionsText,
      deletions.element,
      deletionsText,
      pendingText,
    ),
    h(
      "span",
      { className: "time-wrap", "data-tip": i18n.t("timeHint", [format(LINES_PER_HOUR)]) },
      h("span", { className: "stat clock" }, clockIcon(), time.element),
      timeWords,
      timeLabel,
      done,
    ),
  );

  const render = (totals: Totals, all: Totals = totals) => {
    const left = totals.visible - totals.viewed;
    files.set(format(left), format(all.total));
    filesText.textContent = filesGroup.dataset.tip = i18n.t("panelFilesLeft", left, [format(left)]);
    const added = `+${format(totals.additions)}`;
    const removed = `−${format(totals.deletions)}`;
    additions.set(added, `+${format(all.additions)}`);
    deletions.set(removed, `−${format(all.deletions)}`);
    additionsText.textContent = ` ${added} ${i18n.t("panelLinesAdded")}`;
    deletionsText.textContent = ` ${removed} ${i18n.t("panelLinesRemoved")}`;
    time.set(totals.minutesLeft === 0 ? "–" : formatClock(totals.minutesLeft), formatClock(all.minutes));
    element.toggleAttribute("data-done", isDone(totals));
    timeWords.textContent = totals.minutesLeft === 0 ? "" : ` ${formatDuration(totals.minutesLeft)}`;
    timeLabel.textContent = totals.minutesLeft === 0 ? "" : ` ${i18n.t("panelTimeLabel")}`;
    const notLoaded = totals.pending > 0 ? i18n.t("panelNotLoaded", totals.pending, [format(totals.pending)]) : "";
    if (notLoaded) element.dataset.tip = notLoaded;
    else delete element.dataset.tip;
    pendingText.textContent = notLoaded ? ` ${notLoaded}` : "";
  };

  return { element, render, done };
};
