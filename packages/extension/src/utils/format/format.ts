import { durationParts, roundMinutes } from "@focus-diff/core/duration";

import { i18n } from "#i18n";
import { uiLanguage } from "@/utils/i18n/i18n";

let numberFormat: Intl.NumberFormat | null = null;

export const formatNumber = (value: number): string => {
  numberFormat ??= new Intl.NumberFormat(uiLanguage());
  return numberFormat.format(value);
};

/** Formats an estimate in minutes: under a minute, whole minutes, then five-minute steps past an hour. */
export const formatDuration = (minutes: number): string => {
  const parts = durationParts(minutes);
  if (!parts) return i18n.t("timeUnderMinute");
  if (!parts.hours) return i18n.t("timeMinutes", [parts.minutes]);
  return parts.minutes ? i18n.t("timeHoursMinutes", [parts.hours, parts.minutes]) : i18n.t("timeHours", [parts.hours]);
};

/** The same estimate as a clock, h:mm, for the panel's fixed-width digits. Anything under a minute shows as 0:01. */
export const formatClock = (minutes: number): string => {
  const rounded = Math.max(1, roundMinutes(minutes));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};
