import { dayOfWeekFor, partsInZone } from '../common/timezone';

export interface OpeningWindow {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}

/**
 * Whether a shop is open at `now`, judged by its own wall clock.
 *
 * A directory listing shops across time zones has to answer this per shop —
 * "open" in Jakarta and "open" in Makassar are different instants. The comparison
 * is half-open, `[open, close)`, matching how slots are generated: a shop closing
 * at 20:00 is shut at 20:00, not still open for a zero-length moment.
 *
 * A weekday with no row is a closed day.
 */
export function isOpenAt(
  hours: readonly OpeningWindow[],
  timezone: string,
  now: Date = new Date(),
): boolean {
  const { year, month, day, hour, minute } = partsInZone(timezone, now);
  const today = hours.find((window) => window.dayOfWeek === dayOfWeekFor(year, month, day));

  if (!today) {
    return false;
  }

  const minuteOfDay = hour * 60 + minute;

  return minuteOfDay >= today.openMinute && minuteOfDay < today.closeMinute;
}
