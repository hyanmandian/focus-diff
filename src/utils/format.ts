import { i18n } from '#i18n';
import { uiLanguage } from '@/utils/i18n';

export const LINES_PER_HOUR = 400;

let numberFormat: Intl.NumberFormat | null = null;

export const formatNumber = (value: number): string => {
  numberFormat ??= new Intl.NumberFormat(uiLanguage());
  return numberFormat.format(value);
};

export const formatDuration = (lines: number): string => {
  const minutes = (lines / LINES_PER_HOUR) * 60;
  if (minutes < 1) return i18n.t('timeUnderMinute');
  if (minutes < 60) return i18n.t('timeMinutes', [Math.round(minutes)]);
  const rounded = Math.round(minutes / 5) * 5;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? i18n.t('timeHoursMinutes', [hours, rest]) : i18n.t('timeHours', [hours]);
};
