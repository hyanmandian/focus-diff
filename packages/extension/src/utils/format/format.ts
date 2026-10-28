import { durationParts, roundMinutes } from "@focus-diff/core/duration";

import { i18n } from "#i18n";
import { uiLanguage } from "@/utils/i18n/i18n";

let numberFormat: Intl.NumberFormat | null = null;

export const formatNumber = (value: number): string => {
  numberFormat ??= new Intl.NumberFormat(uiLanguage());
  return numberFormat.format(value);
};

export const formatDuration = (minutes: number): string => {
  const parts = durationParts(minutes);
  if (!parts) return i18n.t("timeUnderMinute");
  if (!parts.hours) return i18n.t("timeMinutes", [parts.minutes]);
  return parts.minutes ? i18n.t("timeHoursMinutes", [parts.hours, parts.minutes]) : i18n.t("timeHours", [parts.hours]);
};

export const formatClock = (minutes: number): string => {
  const rounded = Math.max(1, roundMinutes(minutes));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};
