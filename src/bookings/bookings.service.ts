import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Booking, type Service, type Shop } from '@prisma/client';
import { SLOT_STEP_MINUTES } from '../availability/slot-calculator';
import { dayOfWeekFor, partsInZone } from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateBookingDto } from './dto/create-booking.dto';
import { isDeadlock, isOverlapViolation } from './overlap-violation';

/**
 * A deadlock victim gets to try again. Two retries is plenty: each one waits for
 * the competing transaction to finish, after which the outcome is decided —
 * either the slot is now taken (a clean 409) or it is genuinely free.
 */
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a booking, or rejects it as taken.
   *
   * The checks below reject the *obviously* wrong: a closed day, a time outside
   * opening hours, a start that is not one of the offered slots. None of them
   * makes the slot safe — between any check and the insert, another request can
   * take the same slot. What makes it safe is the exclusion constraint on the
   * table: Postgres refuses the second insert no matter how the two requests
   * interleave, and that refusal is what becomes the 409 below.
   */
  async create(shopId: string, customerId: string, dto: CreateBookingDto): Promise<Booking> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    // Re-checked against shopId: knowing an id from another tenant must not be
    // enough to book with it.
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, shopId, active: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found in this shop');
    }

    const staff = await this.prisma.staff.findFirst({
      where: { id: dto.staffId, shopId, active: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found in this shop');
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(startTime.getTime() + service.durationMinutes * 60_000);

    await this.assertWithinOpeningHours(shop, service, startTime);

    const data = {
      shopId,
      serviceId: service.id,
      staffId: staff.id,
      customerId,
      startTime,
      endTime,
    };

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.insertSerialisedByStaff(staff.id, data);
      } catch (error) {
        if (isOverlapViolation(error)) {
          // Expected under contention, so logged at debug rather than as a fault.
          this.logger.debug(
            `Overlap rejected by the database for staff ${staff.id} at ${startTime.toISOString()}`,
          );
          throw new ConflictException('That slot has just been taken');
        }

        if (isDeadlock(error) && attempt < MAX_ATTEMPTS) {
          this.logger.debug(`Deadlock on attempt ${attempt}; retrying`);
          // A little jitter so retries do not line up and deadlock again.
          await sleep(attempt * 10 + Math.random() * 15);
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Inserts the booking while holding a transaction-scoped advisory lock keyed
   * on the staff member.
   *
   * The exclusion constraint alone is *correct* but not *well-behaved* under
   * contention. Two conflicting inserts each wait on the other transaction to
   * find out whether the conflict is real, which is a cycle, and Postgres
   * breaks it by killing one with a deadlock error. Measured, that happened on
   * roughly a third of three-way races — turning what should be a clean 409
   * into a 500.
   *
   * The advisory lock removes the cycle: every booking for a given staff member
   * queues behind the same single lock, so the loser waits, then inserts, then
   * gets a truthful exclusion violation. Bookings for *different* staff hash to
   * different keys and still run in parallel.
   *
   * The lock is an optimisation for behaviour, not the safety mechanism. It is
   * advisory — nothing forces a future code path to take it — so the constraint
   * stays as the guarantee that no two overlapping bookings can ever exist,
   * whatever the application does. Belt and braces, with the braces in the
   * database.
   */
  private insertSerialisedByStaff(
    staffId: string,
    data: Prisma.BookingUncheckedCreateInput,
  ): Promise<Booking> {
    return this.prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: the function returns void, which Prisma
      // cannot deserialize as a column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${staffId}::text, 0))`;

      return tx.booking.create({ data });
    });
  }

  listForCustomer(customerId: string): Promise<Booking[]> {
    return this.prisma.booking.findMany({
      where: { customerId },
      orderBy: { startTime: 'desc' },
    });
  }

  async findOwnOrThrow(bookingId: string, customerId: string): Promise<Booking> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  /**
   * Rejects times the shop never offered: the wrong side of opening hours, a
   * closed day, a start off the slot grid, or a time already gone.
   */
  private async assertWithinOpeningHours(
    shop: Shop,
    service: Service,
    startTime: Date,
    now: Date = new Date(),
  ): Promise<void> {
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime is not a valid instant');
    }

    if (startTime <= now) {
      throw new BadRequestException('Cannot book a time in the past');
    }

    const { year, month, day, hour, minute, second } = partsInZone(shop.timezone, startTime);

    if (second !== 0 || startTime.getMilliseconds() !== 0) {
      throw new BadRequestException('startTime must fall on a whole minute');
    }

    const hours = await this.prisma.workingHours.findUnique({
      where: { shopId_dayOfWeek: { shopId: shop.id, dayOfWeek: dayOfWeekFor(year, month, day) } },
    });

    if (!hours) {
      throw new BadRequestException('The shop is closed on that day');
    }

    const startMinute = hour * 60 + minute;
    const endMinute = startMinute + service.durationMinutes;

    if (startMinute < hours.openMinute || endMinute > hours.closeMinute) {
      throw new BadRequestException('That time falls outside the shop’s opening hours');
    }

    // The API accepts only what it advertises: availability offers starts on a
    // grid measured from opening time, so 09:07 is refused even though it would
    // technically fit.
    if ((startMinute - hours.openMinute) % SLOT_STEP_MINUTES !== 0) {
      throw new BadRequestException(
        `startTime must be one of the offered slots (every ${SLOT_STEP_MINUTES} minutes from opening)`,
      );
    }
  }
}
