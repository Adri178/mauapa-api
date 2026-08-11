/**
 * Wall-clock ↔ instant conversion for IANA time zones, built on Intl.
 *
 * Why not a library: the only operation this project needs is "given a calendar
 * date and a minute-of-day in a shop's zone, what instant is that?". That is
 * roughly thirty lines against Intl, which ships with Node and carries the
 * current tzdata. Pulling in luxon or date-fns-tz for one function would be a
 * dependency we do not need — but the algorithm is subtle enough that it is
 * tested against real DST transitions rather than trusted by inspection.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The calendar fields an instant shows when read in `timeZone`. */
export function partsInZone(timeZone: string, instant: Date): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * How far `timeZone` sits from UTC at `instant`, in milliseconds. Positive east
 * of Greenwich: Asia/Jakarta returns +7h.
 */
export function zoneOffsetMs(timeZone: string, instant: Date): number {
  const { year, month, day, hour, minute, second } = partsInZone(timeZone, instant);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  // formatToParts has no milliseconds, so compare against a whole second.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which `timeZone` reads the given calendar date and
 * minute-of-day.
 *
 * The offset can only be looked up *at an instant*, but the instant is what we
 * are solving for, so this iterates: guess, re-read the offset there, correct.
 * A candidate is the answer when the offset used to build it is the offset that
 * actually applies at it.
 *
 * DST leaves two cases where no single answer is right:
 *
 * - **Skipped** times (spring-forward: 02:30 never happens) resolve *forward*,
 *   to the reading the clock jumped to. Resolving backward would place a slot
 *   before the shop opened.
 * - **Repeated** times (autumn fall-back: 01:30 happens twice) resolve to the
 *   first occurrence — the earlier instant, and the one a customer reading a
 *   schedule would assume.
 */
export function wallClockToInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, minutesFromMidnight);

  const offsetNearGuess = zoneOffsetMs(timeZone, new Date(naiveUtc));
  const candidate = naiveUtc - offsetNearGuess;

  const offsetAtCandidate = zoneOffsetMs(timeZone, new Date(candidate));
  if (offsetAtCandidate === offsetNearGuess) {
    return new Date(candidate);
  }

  const corrected = naiveUtc - offsetAtCandidate;
  if (zoneOffsetMs(timeZone, new Date(corrected)) === offsetAtCandidate) {
    return new Date(corrected);
  }

  // Neither candidate reads back as the requested time: it does not exist.
  // The later instant is the post-jump clock reading.
  return new Date(Math.max(candidate, corrected));
}

/** Today's calendar date in `timeZone`, as {year, month, day}. */
export function todayInZone(
  timeZone: string,
  now: Date = new Date(),
): { year: number; month: number; day: number } {
  const { year, month, day } = partsInZone(timeZone, now);
  return { year, month, day };
}

/**
 * Weekday of a calendar date, 0 = Sunday … 6 = Saturday. A date's weekday is a
 * pure calendar fact, so no zone is involved.
 */
export function dayOfWeekFor(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Rejects zones Intl does not recognise, so a bad shop timezone fails loudly. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
