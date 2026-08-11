import { BookingStatus } from '@prisma/client';
import { buildQueue } from './queue-position';
import type { QueueRow } from './queue.types';

const row = (id: string, status: BookingStatus, customerId = 'someone-else'): QueueRow => ({
  bookingId: id,
  status,
  startTime: new Date(`2027-06-16T0${id}:00:00Z`),
  staffId: 'staff-1',
  staffName: 'Andi',
  serviceName: 'Potong Rambut',
  customerId,
  customerName: 'Budi Santoso',
});

const shopStaff = { id: 'owner-1', canSeeCustomerNames: true };
const customer = { id: 'cust-1', canSeeCustomerNames: false };

describe('buildQueue', () => {
  describe('positions', () => {
    it('numbers waiting bookings from 1, in order', () => {
      const entries = buildQueue(
        [
          row('1', BookingStatus.BOOKED),
          row('2', BookingStatus.WAITING),
          row('3', BookingStatus.BOOKED),
        ],
        shopStaff,
      );

      expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    });

    it('gives no position to a booking being served', () => {
      const entries = buildQueue(
        [row('1', BookingStatus.IN_PROGRESS), row('2', BookingStatus.WAITING)],
        shopStaff,
      );

      expect(entries.map((entry) => entry.position)).toEqual([null, 1]);
    });

    it('closes the gap when the person being served is skipped', () => {
      // The customer at 09:00 is in the chair; the next two are 1 and 2, not 2 and 3.
      const entries = buildQueue(
        [
          row('1', BookingStatus.IN_PROGRESS),
          row('2', BookingStatus.BOOKED),
          row('3', BookingStatus.BOOKED),
        ],
        shopStaff,
      );

      expect(entries.map((entry) => entry.position)).toEqual([null, 1, 2]);
    });

    it('leaves no gap where a booking was cancelled', () => {
      const entries = buildQueue(
        [
          row('1', BookingStatus.BOOKED),
          row('2', BookingStatus.CANCELLED),
          row('3', BookingStatus.BOOKED),
        ],
        shopStaff,
      );

      expect(entries.map((entry) => entry.position)).toEqual([1, null, 2]);
    });

    it('gives no position to finished work', () => {
      const entries = buildQueue(
        [row('1', BookingStatus.DONE), row('2', BookingStatus.BOOKED)],
        shopStaff,
      );

      expect(entries.map((entry) => entry.position)).toEqual([null, 1]);
    });

    it('handles an empty queue', () => {
      expect(buildQueue([], shopStaff)).toEqual([]);
    });

    it('handles a queue with nobody waiting', () => {
      const entries = buildQueue(
        [row('1', BookingStatus.DONE), row('2', BookingStatus.CANCELLED)],
        shopStaff,
      );

      expect(entries.every((entry) => entry.position === null)).toBe(true);
    });
  });

  describe('what each viewer may see', () => {
    it('shows customer names to the shop', () => {
      const [entry] = buildQueue([row('1', BookingStatus.BOOKED)], shopStaff);

      expect(entry.customerName).toBe('Budi Santoso');
    });

    it('hides customer names from a customer', () => {
      const [entry] = buildQueue([row('1', BookingStatus.BOOKED)], customer);

      expect(entry.customerName).toBeNull();
    });

    it('still marks the customer’s own booking', () => {
      const entries = buildQueue(
        [row('1', BookingStatus.BOOKED, 'cust-1'), row('2', BookingStatus.BOOKED, 'cust-2')],
        customer,
      );

      expect(entries.map((entry) => entry.isYours)).toEqual([true, false]);
    });

    it('lets a customer find their own position without seeing anyone else', () => {
      const entries = buildQueue(
        [
          row('1', BookingStatus.IN_PROGRESS, 'cust-9'),
          row('2', BookingStatus.BOOKED, 'cust-8'),
          row('3', BookingStatus.BOOKED, 'cust-1'),
        ],
        customer,
      );

      const mine = entries.find((entry) => entry.isYours);
      expect(mine?.position).toBe(2);
      expect(entries.every((entry) => entry.customerName === null)).toBe(true);
    });
  });
});
