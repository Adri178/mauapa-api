/**
 * The slot arithmetic, kept free of database and clock so it can be tested
 * exhaustively. Everything here is pure.
 */

/**
 * Candidate start times are offered on a 15-minute grid measured from opening
 * time. A finer grid buries the customer in near-identical options; a coarser
 * one hides real availability for short services.
 */
export const SLOT_STEP_MINUTES = 15;

export interface Interval {
  start: Date;
  end: Date;
}

/**
 * Minute-of-day start times that fit entirely inside the opening window.
 *
 * A service must *finish* by closing time, so the last candidate is
 * `close - duration`. A duration longer than the window yields nothing.
 */
export function candidateStartMinutes(
  openMinute: number,
  closeMinute: number,
  durationMinutes: number,
  stepMinutes: number = SLOT_STEP_MINUTES,
): number[] {
  const starts: number[] = [];
  const lastStart = closeMinute - durationMinutes;

  for (let minute = openMinute; minute <= lastStart; minute += stepMinutes) {
    starts.push(minute);
  }

  return starts;
}

/**
 * Half-open overlap: [start, end). A booking ending at 10:00 and one starting
 * at 10:00 do not overlap — back-to-back appointments are the normal case, and
 * treating the boundary as a clash would wrongly hide half the schedule.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isFree(slot: Interval, busy: readonly Interval[]): boolean {
  return !busy.some((taken) => overlaps(slot, taken));
}

export function freeSlots(slots: readonly Interval[], busy: readonly Interval[]): Interval[] {
  return slots.filter((slot) => isFree(slot, busy));
}
