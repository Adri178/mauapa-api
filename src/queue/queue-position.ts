import { BookingStatus } from '@prisma/client';
import type { QueueEntryDto, QueueRow } from './queue.types';

/**
 * Numbers the waiting line and shapes each row for one viewer.
 *
 * Positions count only bookings still waiting — BOOKED and WAITING. Once
 * someone is being served their position is meaningless, and a cancelled
 * booking must not leave a gap in the numbering, so positions are assigned by
 * walking the waiting rows in start-time order rather than by row index.
 *
 * Position is per shop, not per staff member: a customer wants to know how many
 * people are ahead of them in the shop, which is what the numbers on the wall
 * mean.
 */
export function buildQueue(
  rows: readonly QueueRow[],
  viewer: { id: string; canSeeCustomerNames: boolean },
): QueueEntryDto[] {
  let nextPosition = 1;

  return rows.map((row) => ({
    bookingId: row.bookingId,
    position: isWaiting(row.status) ? nextPosition++ : null,
    status: row.status,
    startTime: row.startTime,
    staffId: row.staffId,
    staffName: row.staffName,
    serviceName: row.serviceName,
    // Customers see an anonymous line; the shop sees who is in it.
    customerName: viewer.canSeeCustomerNames ? row.customerName : null,
    isYours: row.customerId === viewer.id,
  }));
}

function isWaiting(status: BookingStatus): boolean {
  return status === BookingStatus.BOOKED || status === BookingStatus.WAITING;
}
