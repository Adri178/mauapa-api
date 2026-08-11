import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { partsInZone, todayInZone, wallClockToInstant } from '../common/timezone';
import { PrismaService } from '../prisma/prisma.service';
import { buildQueue } from './queue-position';
import type { QueueDto, QueueRow } from './queue.types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A shop's queue for one day, shaped for whoever is asking.
   *
   * `date` defaults to today *in the shop's own time zone*, not the server's —
   * a shop in Jakarta should see its own Tuesday.
   */
  async forShop(shopId: string, viewer: AuthenticatedUser, date?: string): Promise<QueueDto> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    const { year, month, day } = this.resolveDate(shop.timezone, date);
    const dayStart = wallClockToInstant(shop.timezone, year, month, day, 0);
    const dayEnd = wallClockToInstant(shop.timezone, year, month, day, 24 * 60);

    const bookings = await this.prisma.booking.findMany({
      where: { shopId, startTime: { gte: dayStart, lt: dayEnd } },
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        startTime: true,
        staffId: true,
        staff: { select: { name: true } },
        service: { select: { name: true } },
        customerId: true,
        customer: { select: { name: true } },
      },
    });

    const rows: QueueRow[] = bookings.map((booking) => ({
      bookingId: booking.id,
      status: booking.status,
      startTime: booking.startTime,
      staffId: booking.staffId,
      staffName: booking.staff.name,
      serviceName: booking.service.name,
      customerId: booking.customerId,
      customerName: booking.customer.name,
    }));

    return {
      shopId,
      date: format(year, month, day),
      entries: buildQueue(rows, {
        id: viewer.id,
        canSeeCustomerNames: await this.canSeeCustomerNames(shopId, viewer),
      }),
    };
  }

  /**
   * Rebuilds the queue for broadcasting. The socket audience is mixed, so this
   * takes the cautious view: no customer names, and nothing marked as anyone's
   * own booking. Each client can call the HTTP endpoint for its own view.
   */
  async forBroadcast(shopId: string, date?: string): Promise<QueueDto> {
    return this.forShop(shopId, { id: '', email: '', role: Role.CUSTOMER }, date);
  }

  /** The calendar date a booking falls on, read in the shop's own time zone. */
  dateOf(timezone: string, instant: Date): string {
    const { year, month, day } = partsInZone(timezone, instant);
    return format(year, month, day);
  }

  private async canSeeCustomerNames(shopId: string, viewer: AuthenticatedUser): Promise<boolean> {
    if (viewer.role === Role.OWNER) {
      const owned = await this.prisma.shop.count({ where: { id: shopId, ownerId: viewer.id } });
      return owned > 0;
    }

    if (viewer.role === Role.STAFF) {
      const works = await this.prisma.staff.count({
        where: { shopId, userId: viewer.id, active: true },
      });
      return works > 0;
    }

    return false;
  }

  private resolveDate(
    timezone: string,
    date?: string,
  ): { year: number; month: number; day: number } {
    if (!date) {
      return todayInZone(timezone);
    }

    if (!ISO_DATE.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const [year, month, day] = date.split('-').map(Number);
    const asUtc = new Date(Date.UTC(year, month - 1, day));

    if (
      asUtc.getUTCFullYear() !== year ||
      asUtc.getUTCMonth() !== month - 1 ||
      asUtc.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${date} is not a real calendar date`);
    }

    return { year, month, day };
  }
}

const format = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
