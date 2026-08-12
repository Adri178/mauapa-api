import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, Prisma, type Booking, type Service, type Shop } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SLOT_STEP_MINUTES } from '../availability/slot-calculator';
import { paginate, type PageDto } from '../common/pagination.dto';
import { dayOfWeekFor, partsInZone, wallClockToInstant } from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { QueueGateway } from '../queue/queue.gateway';
import { QueueService } from '../queue/queue.service';
import { ShopsService } from '../shops/shops.service';
import type { MyBookingDto } from './dto/booking-response.dto';
import type { CreateBookingDto } from './dto/create-booking.dto';
import type { ListBookingsQueryDto, ListMyBookingsQueryDto } from './dto/list-bookings.dto';
import { isDeadlock, isOverlapViolation } from './overlap-violation';
import { allowedTransitions, canTransition } from './transitions';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly shops: ShopsService,
    private readonly queue: QueueGateway,
    private readonly queueDates: QueueService,
  ) {}

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
        const booking = await this.insertSerialisedByStaff(staff.id, data);

        // Only after the row is committed: a queue that shows a booking the
        // database rejected would be worse than one that updates a moment late.
        await this.queue.broadcast(shopId, this.queueDates.dateOf(shop.timezone, startTime));

        return booking;
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

  /**
   * Moves a booking along its lifecycle, on behalf of the shop.
   *
   * Authorisation is the caller's; the transition rules are the domain's. Both
   * have to pass, and the broadcast only happens once the change is committed —
   * announcing a state the database never reached would be worse than silence.
   */
  async updateStatus(
    shopId: string,
    bookingId: string,
    status: BookingStatus,
    user: AuthenticatedUser,
  ): Promise<Booking> {
    const shop = await this.shops.assertCanManageOrThrow(shopId, user);

    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, shopId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    this.assertTransitionAllowed(booking.status, status);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status },
    });

    await this.queue.broadcast(shopId, this.queueDates.dateOf(shop.timezone, booking.startTime));

    return updated;
  }

  /** A customer calling off their own booking. */
  async cancelOwn(bookingId: string, customerId: string): Promise<Booking> {
    const booking = await this.findOwnOrThrow(bookingId, customerId);

    this.assertTransitionAllowed(booking.status, BookingStatus.CANCELLED);

    const cancelled = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    });

    const shop = await this.prisma.shop.findUniqueOrThrow({ where: { id: booking.shopId } });
    await this.queue.broadcast(
      booking.shopId,
      this.queueDates.dateOf(shop.timezone, booking.startTime),
    );

    return cancelled;
  }

  private assertTransitionAllowed(from: BookingStatus, to: BookingStatus): void {
    if (!canTransition(from, to)) {
      const allowed = allowedTransitions(from);

      throw new BadRequestException(
        allowed.length === 0
          ? `A ${from} booking is final and cannot change status`
          : `Cannot move a booking from ${from} to ${to}; allowed: ${allowed.join(', ')}`,
      );
    }
  }

  async listForCustomer(
    customerId: string,
    query: ListMyBookingsQueryDto,
  ): Promise<PageDto<MyBookingDto>> {
    const where = { customerId, ...(query.status ? { status: query.status } : {}) };

    // One round trip for the rows and one for the count, issued together — the
    // total is what tells a client whether another page exists.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { startTime: query.order },
        skip: query.skip,
        take: query.limit,
        // Joined here rather than left to the client: rendering one row would
        // otherwise take three more requests.
        include: {
          shop: { select: { name: true, timezone: true } },
          service: { select: { name: true, durationMinutes: true, price: true } },
          staff: { select: { name: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    const data = rows.map(({ shop, service, staff, ...booking }) => ({
      ...booking,
      shopName: shop.name,
      shopTimezone: shop.timezone,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      staffName: staff.name,
    }));

    return paginate(data, total, query);
  }

  /** The operational view: everything on the shop's books, filtered. */
  async listForShop(
    shopId: string,
    user: AuthenticatedUser,
    query: ListBookingsQueryDto,
  ): Promise<PageDto<Booking>> {
    const shop = await this.shops.assertCanManageOrThrow(shopId, user);

    const where: Prisma.BookingWhereInput = {
      shopId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.date ? this.dayRange(shop.timezone, query.date) : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { startTime: query.order },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  /** Turns a calendar date in the shop's zone into an instant range. */
  private dayRange(timezone: string, date: string): Prisma.BookingWhereInput {
    const [year, month, day] = date.split('-').map(Number);
    const asUtc = new Date(Date.UTC(year, month - 1, day));

    if (
      asUtc.getUTCFullYear() !== year ||
      asUtc.getUTCMonth() !== month - 1 ||
      asUtc.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${date} is not a real calendar date`);
    }

    return {
      startTime: {
        gte: wallClockToInstant(timezone, year, month, day, 0),
        lt: wallClockToInstant(timezone, year, month, day, 24 * 60),
      },
    };
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
