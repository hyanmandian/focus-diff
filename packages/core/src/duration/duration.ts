export const roundMinutes = (minutes: number): number =>
  minutes < 60 ? Math.round(minutes) : Math.round(minutes / 5) * 5;

export const durationParts = (minutes: number): { hours: number; minutes: number } | null => {
  if (minutes < 1) return null;
  const rounded = roundMinutes(minutes);
  if (minutes < 60) return { hours: 0, minutes: rounded };
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
};
