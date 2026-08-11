import { BookingStatus } from '@prisma/client';
import { allowedTransitions, canTransition, isTerminal } from './transitions';

const ALL = Object.values(BookingStatus);

describe('booking transitions', () => {
  describe('the happy path', () => {
    it('walks BOOKED → WAITING → IN_PROGRESS → DONE', () => {
      expect(canTransition(BookingStatus.BOOKED, BookingStatus.WAITING)).toBe(true);
      expect(canTransition(BookingStatus.WAITING, BookingStatus.IN_PROGRESS)).toBe(true);
      expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.DONE)).toBe(true);
    });

    it('lets a walk-in skip the queue and start immediately', () => {
      expect(canTransition(BookingStatus.BOOKED, BookingStatus.IN_PROGRESS)).toBe(true);
    });
  });

  describe('cancellation', () => {
    it.each([BookingStatus.BOOKED, BookingStatus.WAITING, BookingStatus.IN_PROGRESS])(
      'is allowed from %s',
      (from) => {
        expect(canTransition(from, BookingStatus.CANCELLED)).toBe(true);
      },
    );

    it('is not allowed once the work is done', () => {
      expect(canTransition(BookingStatus.DONE, BookingStatus.CANCELLED)).toBe(false);
    });
  });

  describe('terminal statuses', () => {
    it.each([BookingStatus.DONE, BookingStatus.CANCELLED])(
      '%s allows nothing further',
      (status) => {
        expect(isTerminal(status)).toBe(true);
        expect(allowedTransitions(status)).toEqual([]);

        for (const target of ALL) {
          expect(canTransition(status, target)).toBe(false);
        }
      },
    );

    it.each([BookingStatus.BOOKED, BookingStatus.WAITING, BookingStatus.IN_PROGRESS])(
      '%s is not terminal',
      (status) => {
        expect(isTerminal(status)).toBe(false);
      },
    );
  });

  describe('moves that must never be allowed', () => {
    it('never lets a booking go backwards', () => {
      expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.WAITING)).toBe(false);
      expect(canTransition(BookingStatus.IN_PROGRESS, BookingStatus.BOOKED)).toBe(false);
      expect(canTransition(BookingStatus.WAITING, BookingStatus.BOOKED)).toBe(false);
      expect(canTransition(BookingStatus.DONE, BookingStatus.IN_PROGRESS)).toBe(false);
    });

    it('never lets work be finished before it starts', () => {
      expect(canTransition(BookingStatus.BOOKED, BookingStatus.DONE)).toBe(false);
      expect(canTransition(BookingStatus.WAITING, BookingStatus.DONE)).toBe(false);
    });

    it('never allows a status to transition to itself', () => {
      for (const status of ALL) {
        expect(canTransition(status, status)).toBe(false);
      }
    });
  });

  it('covers every status, so a new one cannot be forgotten', () => {
    for (const status of ALL) {
      expect(allowedTransitions(status)).toBeDefined();
    }
  });
});
