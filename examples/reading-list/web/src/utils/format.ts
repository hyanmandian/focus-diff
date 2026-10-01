export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));

export const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
