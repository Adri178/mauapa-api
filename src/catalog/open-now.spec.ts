import { isOpenAt, type OpeningWindow } from './open-now';

/** Wednesday 09:00–20:00, Saturday 09:00–21:00, closed otherwise. */
const HOURS: OpeningWindow[] = [
  { dayOfWeek: 3, openMinute: 9 * 60, closeMinute: 20 * 60 },
  { dayOfWeek: 6, openMinute: 9 * 60, closeMinute: 21 * 60 },
];

// 2026-08-12 is a Wednesday. Asia/Jakarta is UTC+7 and never shifts.
const jakarta = (hhmm: string) => new Date(`2026-08-12T${hhmm}:00+07:00`);

describe('isOpenAt', () => {
  describe('within an open day', () => {
    it.each([
      ['09:00', true, 'exactly at opening'],
      ['09:01', true, 'just after opening'],
      ['13:30', true, 'mid-afternoon'],
      ['19:59', true, 'a minute before closing'],
    ])('%s → %s (%s)', (time, expected) => {
      expect(isOpenAt(HOURS, 'Asia/Jakarta', jakarta(time))).toBe(expected);
    });
  });

  describe('outside opening hours', () => {
    it.each([
      ['08:59', 'a minute before opening'],
      ['00:00', 'midnight'],
      ['23:30', 'late evening'],
    ])('%s is closed (%s)', (time) => {
      expect(isOpenAt(HOURS, 'Asia/Jakarta', jakarta(time))).toBe(false);
    });

    it('is closed exactly at closing time', () => {
      // Half-open, matching slot generation: 20:00 is shut, not open for an instant.
      expect(isOpenAt(HOURS, 'Asia/Jakarta', jakarta('20:00'))).toBe(false);
    });
  });

  it('treats a weekday with no row as closed', () => {
    // 2026-08-13 is a Thursday, which HOURS does not cover.
    expect(isOpenAt(HOURS, 'Asia/Jakarta', new Date('2026-08-13T13:00:00+07:00'))).toBe(false);
  });

  it('is closed when the shop has no hours at all', () => {
    expect(isOpenAt([], 'Asia/Jakarta', jakarta('13:00'))).toBe(false);
  });

  it('reads the clock in the shop’s zone, not the server’s', () => {
    // 2026-08-12T04:00Z is 11:00 in Jakarta (open) but 04:00 in London (closed).
    const instant = new Date('2026-08-12T04:00:00Z');

    expect(isOpenAt(HOURS, 'Asia/Jakarta', instant)).toBe(true);
    expect(isOpenAt(HOURS, 'Europe/London', instant)).toBe(false);
  });

  it('follows a zone across its DST shift', () => {
    // New York opens 09:00 local either way; the instant that means moves.
    const nyHours: OpeningWindow[] = [{ dayOfWeek: 0, openMinute: 9 * 60, closeMinute: 17 * 60 }];

    // 2026-01-11 and 2026-07-12 are both Sundays, one EST and one EDT.
    expect(isOpenAt(nyHours, 'America/New_York', new Date('2026-01-11T14:30:00Z'))).toBe(true);
    expect(isOpenAt(nyHours, 'America/New_York', new Date('2026-01-11T13:30:00Z'))).toBe(false);
    expect(isOpenAt(nyHours, 'America/New_York', new Date('2026-07-12T13:30:00Z'))).toBe(true);
  });

  it('handles a day that opens past midnight boundaries sanely', () => {
    // Saturday runs an hour later; Wednesday's rule must not leak into it.
    const saturday = new Date('2026-08-15T20:30:00+07:00');

    expect(isOpenAt(HOURS, 'Asia/Jakarta', saturday)).toBe(true);
  });
});
