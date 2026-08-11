/** SQLSTATE for `exclusion_violation`. */
const EXCLUSION_VIOLATION = '23P01';

/** SQLSTATE for `deadlock_detected`. */
const DEADLOCK_DETECTED = '40P01';

export const OVERLAP_CONSTRAINT = 'bookings_no_overlapping_per_staff';

/**
 * Recognises the exclusion-constraint rejection that means "this slot was taken
 * between our check and our insert".
 *
 * Prisma reports it as a PrismaClientUnknownRequestError with no `code` field —
 * verified against the running database, not assumed — so the SQLSTATE has to
 * be read out of the message text. Both the SQLSTATE and the constraint name
 * are matched: either alone is enough, and requiring both would break if Prisma
 * ever changes how much of the driver error it passes through.
 *
 * The narrowness matters. Treating any insert failure as a taken slot would
 * report a broken database as a polite 409 and hide a real fault.
 */
export function isOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes(EXCLUSION_VIOLATION) || error.message.includes(OVERLAP_CONSTRAINT);
}

/**
 * Recognises Postgres aborting this transaction to break a deadlock.
 *
 * Exclusion constraints make a conflicting inserter *wait* on the other
 * transaction rather than fail immediately, because whether it conflicts
 * depends on whether that transaction commits. With three or more requests
 * racing for the same slot, those waits can form a cycle, and Postgres kills
 * one of them with 40P01.
 *
 * This is not "the slot is taken" — the victim never got an answer — so it must
 * not become a 409. The transaction simply has to be retried, by which point
 * the winner has committed and the retry gets a clean, truthful result.
 *
 * Measured, not theorised: firing three concurrent bookings at one slot forty
 * times over produced 48 exclusion violations and 32 deadlocks.
 */
export function isDeadlock(error: unknown): boolean {
  return error instanceof Error && error.message.includes(DEADLOCK_DETECTED);
}
