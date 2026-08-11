import {
  dayOfWeekFor,
  isValidTimeZone,
  partsInZone,
  wallClockToInstant,
  zoneOffsetMs,
} from './timezone';

const HOUR = 60 * 60 * 1000;

describe('zoneOffsetMs', () => {
  it('reports +7h for Asia/Jakarta, which has no DST', () => {
    expect(zoneOffsetMs('Asia/Jakarta', new Date('2026-01-15T00:00:00Z'))).toBe(7 * HOUR);
    expect(zoneOffsetMs('Asia/Jakarta', new Date('2026-07-15T00:00:00Z'))).toBe(7 * HOUR);
  });

  it('reports 0 for UTC', () => {
    expect(zoneOffsetMs('UTC', new Date('2026-06-01T12:00:00Z'))).toBe(0);
  });

  it('tracks the DST shift in America/New_York', () => {
    // Standard time in January, daylight time in July.
    expect(zoneOffsetMs('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe(-5 * HOUR);
    expect(zoneOffsetMs('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe(-4 * HOUR);
  });

  it('handles a half-hour zone', () => {
    expect(zoneOffsetMs('Asia/Kolkata', new Date('2026-03-01T00:00:00Z'))).toBe(5.5 * HOUR);
  });
});

describe('wallClockToInstant', () => {
  /** Reads an instant back in the zone and renders it as HH:mm. */
  const readBack = (timeZone: string, instant: Date): string => {
    const { hour, minute } = partsInZone(timeZone, instant);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  it('maps 09:00 Jakarta to 02:00 UTC', () => {
    const instant = wallClockToInstant('Asia/Jakarta', 2026, 8, 12, 9 * 60);

    expect(instant.toISOString()).toBe('2026-08-12T02:00:00.000Z');
  });

  it('maps midnight correctly', () => {
    const instant = wallClockToInstant('Asia/Jakarta', 2026, 8, 12, 0);

    expect(instant.toISOString()).toBe('2026-08-11T17:00:00.000Z');
  });

  it('maps 23:59 correctly', () => {
    const instant = wallClockToInstant('Asia/Jakarta', 2026, 8, 12, 23 * 60 + 59);

    expect(instant.toISOString()).toBe('2026-08-12T16:59:00.000Z');
  });

  it('round-trips every quarter hour across several zones and seasons', () => {
    const zones = ['Asia/Jakarta', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'];
    const dates: Array<[number, number, number]> = [
      [2026, 1, 15],
      [2026, 6, 15],
      [2026, 11, 20],
    ];

    for (const zone of zones) {
      for (const [year, month, day] of dates) {
        for (let minute = 0; minute < 1440; minute += 15) {
          const instant = wallClockToInstant(zone, year, month, day, minute);
          const expected = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
            minute % 60,
          ).padStart(2, '0')}`;

          expect(readBack(zone, instant)).toBe(expected);
        }
      }
    }
  });

  describe('DST transitions in America/New_York', () => {
    // 2026-03-08: clocks jump 02:00 → 03:00, so 02:30 never happens.
    it('resolves a skipped wall-clock time to the instant the clock jumped to', () => {
      const instant = wallClockToInstant('America/New_York', 2026, 3, 8, 2 * 60 + 30);

      // 03:30 EDT — the clock reading immediately after the jump.
      expect(readBack('America/New_York', instant)).toBe('03:30');
    });

    it('keeps times either side of the spring-forward exact', () => {
      expect(
        readBack('America/New_York', wallClockToInstant('America/New_York', 2026, 3, 8, 60)),
      ).toBe('01:00');
      expect(
        readBack('America/New_York', wallClockToInstant('America/New_York', 2026, 3, 8, 4 * 60)),
      ).toBe('04:00');
    });

    // 2026-11-01: clocks fall back 02:00 → 01:00, so 01:30 happens twice.
    it('resolves an ambiguous wall-clock time to the earlier of the two instants', () => {
      const instant = wallClockToInstant('America/New_York', 2026, 11, 1, 60 + 30);

      expect(readBack('America/New_York', instant)).toBe('01:30');
      // The earlier occurrence is still on daylight time, UTC-4 → 05:30Z.
      expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    });

    it('keeps times either side of the fall-back exact', () => {
      expect(
        readBack('America/New_York', wallClockToInstant('America/New_York', 2026, 11, 1, 0)),
      ).toBe('00:00');
      expect(
        readBack('America/New_York', wallClockToInstant('America/New_York', 2026, 11, 1, 4 * 60)),
      ).toBe('04:00');
    });
  });
});

describe('dayOfWeekFor', () => {
  it.each([
    [2026, 8, 9, 0], // Sunday
    [2026, 8, 10, 1], // Monday
    [2026, 8, 15, 6], // Saturday
  ])('%i-%i-%i is weekday %i', (year, month, day, expected) => {
    expect(dayOfWeekFor(year, month, day)).toBe(expected);
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones', () => {
    expect(isValidTimeZone('Asia/Jakarta')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects nonsense', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
