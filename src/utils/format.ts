import { i18n } from '#i18n';
import { uiLanguage } from '@/utils/i18n';

let numberFormat: Intl.NumberFormat | null = null;

export const formatNumber = (value: number): string => {
  numberFormat ??= new Intl.NumberFormat(uiLanguage());
  return numberFormat.format(value);
};

/** Formats an estimate in minutes: under a minute, whole minutes, then five-minute steps past an hour. */
export const formatDuration = (minutes: number): string => {
  if (minutes < 1) return i18n.t('timeUnderMinute');
  if (minutes < 60) return i18n.t('timeMinutes', [Math.round(minutes)]);
  const rounded = Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? i18n.t('timeHoursMinutes', [hours, rest]) : i18n.t('timeHours', [hours]);
};
