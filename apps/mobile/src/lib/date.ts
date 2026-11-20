const DATE_KEY_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|T)/;

/** Formats a date using the device's local calendar date. */
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calendar API date fields represent calendar days. Keep their YYYY-MM-DD
 * portion stable across device timezones; convert other values as local dates.
 */
export function getCalendarDateKey(value: string | Date): string {
  if (typeof value === 'string') {
    const dateKey = DATE_KEY_PREFIX.exec(value)?.[1];
    if (dateKey) return dateKey;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return getLocalDateKey(date);
}
