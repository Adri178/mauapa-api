import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate, type PageDto } from '../common/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import { toHhMm } from '../working-hours/working-hours.service';
import type { PublicShopDetailDto, PublicShopDto, ShopSearchQueryDto } from './dto/public-shop.dto';
import { isOpenAt } from './open-now';

/** Only active rows are ever shown; a deactivated service is not on the menu. */
const ACTIVE = { active: true } as const;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The shop directory. Open to anyone, because a customer choosing where to
   * book has not signed up yet — requiring an account first is the sort of wall
   * that makes people close the tab.
   */
  async search(query: ShopSearchQueryDto, now: Date = new Date()): Promise<PageDto<PublicShopDto>> {
    const where: Prisma.ShopWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { address: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [shops, total] = await this.prisma.$transaction([
      this.prisma.shop.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.limit,
        select: {
          id: true,
          name: true,
          address: true,
          timezone: true,
          workingHours: { select: { dayOfWeek: true, openMinute: true, closeMinute: true } },
          _count: { select: { services: { where: ACTIVE }, staff: { where: ACTIVE } } },
        },
      }),
      this.prisma.shop.count({ where }),
    ]);

    const data = shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      address: shop.address,
      timezone: shop.timezone,
      openNow: isOpenAt(shop.workingHours, shop.timezone, now),
      serviceCount: shop._count.services,
      staffCount: shop._count.staff,
    }));

    return paginate(data, total, query);
  }

  /** One shop with everything the slot picker needs behind it. */
  async findOne(shopId: string, now: Date = new Date()): Promise<PublicShopDetailDto> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        address: true,
        timezone: true,
        // Field-by-field rather than whole rows: staff carries a userId, and a
        // public endpoint has no business handing out which account is whom.
        services: {
          where: ACTIVE,
          orderBy: { name: 'asc' },
          select: { id: true, name: true, durationMinutes: true, price: true },
        },
        staff: {
          where: ACTIVE,
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
          select: { dayOfWeek: true, openMinute: true, closeMinute: true },
        },
      },
    });

    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    return {
      id: shop.id,
      name: shop.name,
      address: shop.address,
      timezone: shop.timezone,
      openNow: isOpenAt(shop.workingHours, shop.timezone, now),
      serviceCount: shop.services.length,
      staffCount: shop.staff.length,
      services: shop.services,
      staff: shop.staff,
      workingHours: shop.workingHours.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        open: toHhMm(row.openMinute),
        close: toHhMm(row.closeMinute),
      })),
    };
  }
}
