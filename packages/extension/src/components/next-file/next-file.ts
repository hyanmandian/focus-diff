import { i18n } from "#i18n";
import { nextFileIcon } from "@/components/icons/icons";
import { h } from "@/utils/dom/dom";
import { formatNumber as format } from "@/utils/format/format";

export interface NextFile {
  left: number;
  nextFilter?: { name: string; left: number } | undefined;
}

export const createNextFile = (onNext: () => void) => {
  const element = h(
    "button",
    {
      type: "button",
      className: "icon-button next-file",
      "aria-keyshortcuts": "Alt+Shift+J",
      onClick: () => {
        if (element.getAttribute("aria-disabled") !== "true") onNext();
      },
    },
    nextFileIcon(),
  );

  const render = ({ left, nextFilter }: NextFile) => {
    const label = left
      ? i18n.t("panelNextFile", left, [format(left)])
      : nextFilter
        ? i18n.t("panelNextFilter", nextFilter.left, [nextFilter.name, format(nextFilter.left)])
        : i18n.t("panelAllReviewed");
    element.setAttribute("aria-label", label);
    element.dataset.tip = label;
    element.setAttribute("aria-disabled", String(!left && !nextFilter));
  };

  return { element, render };
};
