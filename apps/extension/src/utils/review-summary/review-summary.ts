import { i18n } from '#i18n';
import { uiLanguage } from '@/utils/i18n/i18n';
import type { ReviewSession } from '@/utils/review-sessions/review-sessions';

/** Review times in words, in the reader's language: their days, their times, how long. */

export const language = uiLanguage();

/** The week as the reader's language starts it: Monday in most places, Sunday in some. */
const firstDay = (() => {
  const locale = new Intl.Locale(language) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  const day = locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay ?? 7;
  return day % 7;
})();
export const WEEK = Array.from({ length: 7 }, (_, index) => (firstDay + index) % 7);
/** A Sunday, to name the days of the week from. */
const SUNDAY = new Date(2024, 0, 7);
export const dayName = (day: number, weekday: 'short' | 'long') =>
  new Intl.DateTimeFormat(language, { weekday }).format(new Date(2024, 0, SUNDAY.getDate() + day));

const list = (items: string[]) => new Intl.ListFormat(language, { type: 'conjunction', style: 'long' }).format(items);
export const time = (value: string) =>
  new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(2024, 0, 1, Number(value.slice(0, 2)), Number(value.slice(3))),
  );

/** "Weekdays at 3:00 PM · 30 min", the way a session reads folded. */
export const sessionSummary = (session: ReviewSession): string => {
  const days = session.days.join();
  const when =
    days === '0,1,2,3,4,5,6'
      ? i18n.t('reviewEveryDay')
      : days === '1,2,3,4,5'
        ? i18n.t('reviewWeekdays')
        : days === '0,6'
          ? i18n.t('reviewWeekends')
          : list(WEEK.filter((day) => session.days.includes(day)).map((day) => dayName(day, 'short')));
  if (!session.days.length) return i18n.t('reviewNoDays');
  const at =
    session.repeat === 'times'
      ? session.times.length
        ? i18n.t('reviewAtTimes', [list(session.times.map(time))])
        : i18n.t('reviewNoTimes')
      : i18n.t('reviewEveryHours', session.every, [session.every, time(session.from), time(session.to)]);
  return `${when} ${at} · ${i18n.t('reviewMinutesShort', [session.minutes])}`;
};
