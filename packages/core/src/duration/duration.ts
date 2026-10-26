/** An estimate in minutes, rounded as it's shown: whole minutes under an hour, then five-minute steps. */
export const roundMinutes = (minutes: number): number =>
  minutes < 60 ? Math.round(minutes) : Math.round(minutes / 5) * 5;

/**
 * An estimate in minutes as hours and minutes to put in words, or null when it's under a minute. Under an hour it's
 * whole minutes (59.6 is 60 minutes, not an hour); past it, five-minute steps.
 */
export const durationParts = (minutes: number): { hours: number; minutes: number } | null => {
  if (minutes < 1) return null;
  const rounded = roundMinutes(minutes);
  if (minutes < 60) return { hours: 0, minutes: rounded };
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
};
