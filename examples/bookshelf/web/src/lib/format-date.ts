export const formatDate = (iso: string, locale = 'en-US') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
