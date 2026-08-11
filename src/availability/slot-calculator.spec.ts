import { candidateStartMinutes, freeSlots, isFree, overlaps } from './slot-calculator';

const at = (iso: string) => new Date(iso);
const interval = (startIso: string, endIso: string) => ({ start: at(startIso), end: at(endIso) });

describe('candidateStartMinutes', () => {
  it('walks the opening window on the 15-minute grid', () => {
    // 09:00–10:00, 30-minute service.
    expect(candidateStartMinutes(540, 600, 30)).toEqual([540, 555, 570]);
  });

  it('stops early enough for the service to finish by closing time', () => {
    const starts = candidateStartMinutes(540, 600, 30);

    expect(Math.max(...starts) + 30).toBeLessThanOrEqual(600);
  });

  it('offers a slot that ends exactly at closing time', () => {
    expect(candidateStartMinutes(540, 600, 60)).toEqual([540]);
  });

  it('returns nothing when the service is longer than the window', () => {
    expect(candidateStartMinutes(540, 600, 90)).toEqual([]);
  });

  it('returns nothing for a zero-length window', () => {
    expect(candidateStartMinutes(540, 540, 30)).toEqual([]);
  });

  it('honours a custom step', () => {
    expect(candidateStartMinutes(540, 600, 30, 30)).toEqual([540, 570]);
  });

  it('covers a full working day', () => {
    // 09:00–17:00, 30-minute service: 09:00 … 16:30 inclusive.
    const starts = candidateStartMinutes(540, 1020, 30);

    expect(starts).toHaveLength(31);
    expect(starts[0]).toBe(540);
    expect(starts.at(-1)).toBe(990);
  });
});

describe('overlaps', () => {
  const booking = interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z');

  it('is false for a slot ending exactly when the booking starts', () => {
    expect(overlaps(interval('2026-08-12T01:30:00Z', '2026-08-12T02:00:00Z'), booking)).toBe(false);
  });

  it('is false for a slot starting exactly when the booking ends', () => {
    expect(overlaps(interval('2026-08-12T02:30:00Z', '2026-08-12T03:00:00Z'), booking)).toBe(false);
  });

  it('is true for an identical interval', () => {
    expect(overlaps(interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z'), booking)).toBe(true);
  });

  it('is true when the slot starts inside the booking', () => {
    expect(overlaps(interval('2026-08-12T02:15:00Z', '2026-08-12T02:45:00Z'), booking)).toBe(true);
  });

  it('is true when the slot ends inside the booking', () => {
    expect(overlaps(interval('2026-08-12T01:45:00Z', '2026-08-12T02:15:00Z'), booking)).toBe(true);
  });

  it('is true when the slot swallows the booking whole', () => {
    expect(overlaps(interval('2026-08-12T01:00:00Z', '2026-08-12T04:00:00Z'), booking)).toBe(true);
  });

  it('is true when the booking swallows the slot whole', () => {
    expect(overlaps(interval('2026-08-12T02:05:00Z', '2026-08-12T02:10:00Z'), booking)).toBe(true);
  });

  it('is symmetric', () => {
    const a = interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z');
    const b = interval('2026-08-12T02:15:00Z', '2026-08-12T02:45:00Z');

    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});

describe('isFree / freeSlots', () => {
  const busy = [
    interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z'),
    interval('2026-08-12T04:00:00Z', '2026-08-12T05:00:00Z'),
  ];

  it('treats a slot clear of every booking as free', () => {
    expect(isFree(interval('2026-08-12T03:00:00Z', '2026-08-12T03:30:00Z'), busy)).toBe(true);
  });

  it('treats a slot clashing with any booking as taken', () => {
    expect(isFree(interval('2026-08-12T04:30:00Z', '2026-08-12T05:30:00Z'), busy)).toBe(false);
  });

  it('leaves everything free when nothing is booked', () => {
    const slots = [interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z')];

    expect(freeSlots(slots, [])).toEqual(slots);
  });

  it('removes exactly the clashing slots', () => {
    const slots = [
      interval('2026-08-12T01:30:00Z', '2026-08-12T02:00:00Z'), // free (abuts)
      interval('2026-08-12T02:00:00Z', '2026-08-12T02:30:00Z'), // taken
      interval('2026-08-12T02:15:00Z', '2026-08-12T02:45:00Z'), // taken
      interval('2026-08-12T02:30:00Z', '2026-08-12T03:00:00Z'), // free (abuts)
      interval('2026-08-12T04:15:00Z', '2026-08-12T04:45:00Z'), // taken
    ];

    expect(freeSlots(slots, busy).map((slot) => slot.start.toISOString())).toEqual([
      '2026-08-12T01:30:00.000Z',
      '2026-08-12T02:30:00.000Z',
    ]);
  });
});
