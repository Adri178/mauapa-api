import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { dayOfWeekFor, wallClockToInstant } from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
  SlotDto,
} from './dto/availability.dto';
import { candidateStartMinutes, freeSlots, type Interval } from './slot-calculator';

/** Statuses that still occupy the diary. A cancelled booking frees its slot. */
const OCCUPYING_STATUSES = [
  BookingStatus.BOOKED,
  BookingStatus.WAITING,
  BookingStatus.IN_PROGRESS,
  BookingStatus.DONE,
];

const toHhMm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Free start times for one service with one staff member on one date.
   *
   * `now` is injectable so tests can pin the clock; production passes nothing.
   */
  async find(
    shopId: string,
    query: AvailabilityQueryDto,
    now: Date = new Date(),
  ): Promise<AvailabilityResponseDto> {
    const { year, month, day } = parseDate(query.date);

    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    // Both are re-checked against shopId: a real id from another tenant must not
    // resolve here just because the caller knows it.
    const service = await this.prisma.service.findFirst({
      where: { id: query.serviceId, shopId, active: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found in this shop');
    }

    const staff = await this.prisma.staff.findFirst({
      where: { id: query.staffId, shopId, active: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found in this shop');
    }

    const base = {
      shopId,
      serviceId: service.id,
      staffId: staff.id,
      date: query.date,
      timezone: shop.timezone,
      durationMinutes: service.durationMinutes,
    };

    const hours = await this.prisma.workingHours.findUnique({
      where: {
        shopId_dayOfWeek: { shopId, dayOfWeek: dayOfWeekFor(year, month, day) },
      },
    });

    if (!hours) {
      return { ...base, open: false, slots: [] };
    }

    const starts = candidateStartMinutes(
      hours.openMinute,
      hours.closeMinute,
      service.durationMinutes,
    );

    const toInterval = (startMinute: number): Interval => ({
      start: wallClockToInstant(shop.timezone, year, month, day, startMinute),
      end: wallClockToInstant(
        shop.timezone,
        year,
        month,
        day,
        startMinute + service.durationMinutes,
      ),
    });

    const candidates = starts.map((startMinute) => ({
      startMinute,
      ...toInterval(startMinute),
    }));

    const busy = await this.busyIntervals(staff.id, shop.timezone, year, month, day);

    const free = freeSlots(candidates, busy) as Array<Interval & { startMinute: number }>;

    return {
      ...base,
      open: true,
      // A slot that has already begun cannot be booked.
      slots: free.filter((slot) => slot.start > now).map(toSlotDto),
    };
  }

  /** Bookings that touch the requested day for this staff member. */
  private async busyIntervals(
    staffId: string,
    timezone: string,
    year: number,
    month: number,
    day: number,
  ): Promise<Interval[]> {
    const dayStart = wallClockToInstant(timezone, year, month, day, 0);
    // Minute 1440 rolls into the next calendar day, which Date.UTC handles.
    const dayEnd = wallClockToInstant(timezone, year, month, day, 24 * 60);

    const bookings = await this.prisma.booking.findMany({
      where: {
        staffId,
        status: { in: OCCUPYING_STATUSES },
        // Any booking that straddles the day boundary still blocks part of it.
        startTime: { lt: dayEnd },
        endTime: { gt: dayStart },
      },
      select: { startTime: true, endTime: true },
    });

    return bookings.map((booking) => ({ start: booking.startTime, end: booking.endTime }));
  }
}

function toSlotDto(slot: Interval & { startMinute: number }): SlotDto {
  return {
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    startLocal: toHhMm(slot.startMinute),
  };
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));

  // Rejects 2026-02-30 and friends, which the regex alone lets through.
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${date} is not a real calendar date`);
  }

  return { year, month, day };
}
