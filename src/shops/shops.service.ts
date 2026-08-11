import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Shop } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateShopDto } from './dto/create-shop.dto';
import type { UpdateShopDto } from './dto/update-shop.dto';

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateShopDto): Promise<Shop> {
    return this.prisma.shop.create({ data: { ...dto, ownerId } });
  }

  listForOwner(ownerId: string): Promise<Shop[]> {
    return this.prisma.shop.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
  }

  /**
   * The single gate every shop-scoped operation passes through. Note the 404:
   * answering 403 for a shop that exists but belongs to someone else would
   * confirm its existence to an outsider probing ids. To a non-owner, another
   * tenant's shop is indistinguishable from one that was never created.
   */
  async findOwnedOrThrow(shopId: string, ownerId: string): Promise<Shop> {
    const shop = await this.prisma.shop.findFirst({ where: { id: shopId, ownerId } });

    if (!shop) {
      throw new NotFoundException('Shop not found');
    }

    return shop;
  }

  /**
   * Whether this user may run a shop's day: its owner, or a staff member who
   * works there. A customer never can.
   *
   * Throws 404 rather than 403 for the same reason findOwnedOrThrow does — an
   * outsider learns nothing about which shop ids exist.
   */
  async assertCanManageOrThrow(shopId: string, user: AuthenticatedUser): Promise<Shop> {
    if (user.role === Role.OWNER) {
      return this.findOwnedOrThrow(shopId, user.id);
    }

    if (user.role === Role.STAFF) {
      const shop = await this.prisma.shop.findFirst({
        where: { id: shopId, staff: { some: { userId: user.id, active: true } } },
      });

      if (shop) {
        return shop;
      }
    }

    throw new NotFoundException('Shop not found');
  }

  async update(shopId: string, ownerId: string, dto: UpdateShopDto): Promise<Shop> {
    await this.findOwnedOrThrow(shopId, ownerId);

    return this.prisma.shop.update({ where: { id: shopId }, data: dto });
  }

  async remove(shopId: string, ownerId: string): Promise<void> {
    await this.findOwnedOrThrow(shopId, ownerId);

    // Services, staff, and working hours cascade at the database level.
    await this.prisma.shop.delete({ where: { id: shopId } });
  }
}
