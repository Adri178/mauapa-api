import { BookingStatus } from '@prisma/client';

/**
 * The lifecycle of a booking, as a pure lookup so it can be tested without a
 * database and read without tracing through service code.
 *
 *   BOOKED ──▶ WAITING ──▶ IN_PROGRESS ──▶ DONE
 *      │          │             │
 *      └──────────┴─────────────┴──▶ CANCELLED
 *
 * BOOKED is the reservation. WAITING means the customer has arrived and is in
 * the queue. DONE and CANCELLED are terminal: reopening finished work would
 * make history unreliable, and a cancelled slot has already been offered back
 * to somebody else.
 */
const ALLOWED: Record<BookingStatus, readonly BookingStatus[]> = {
  [BookingStatus.BOOKED]: [
    BookingStatus.WAITING,
    BookingStatus.IN_PROGRESS,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.WAITING]: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.DONE, BookingStatus.CANCELLED],
  [BookingStatus.DONE]: [],
  [BookingStatus.CANCELLED]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: BookingStatus): readonly BookingStatus[] {
  return ALLOWED[from];
}

/** Statuses a booking can still move on from. */
export function isTerminal(status: BookingStatus): boolean {
  return ALLOWED[status].length === 0;
}

/** Statuses that mean the customer is still waiting to be served. */
export const QUEUEING_STATUSES = [BookingStatus.BOOKED, BookingStatus.WAITING] as const;
