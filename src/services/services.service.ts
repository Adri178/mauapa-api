import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Service } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateServiceDto } from './dto/create-service.dto';
import type { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(shopId: string, dto: CreateServiceDto): Promise<Service> {
    try {
      return await this.prisma.service.create({ data: { ...dto, shopId } });
    } catch (error) {
      throw translateDuplicateName(error);
    }
  }

  list(shopId: string, includeInactive: boolean): Promise<Service[]> {
    return this.prisma.service.findMany({
      where: { shopId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Every read and write filters on shopId as well as the row id. The caller's
   * ownership of the shop is already established by ShopOwnershipGuard, so
   * pairing the two makes a service from another tenant simply not exist.
   */
  async findOneOrThrow(shopId: string, serviceId: string): Promise<Service> {
    const service = await this.prisma.service.findFirst({ where: { id: serviceId, shopId } });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async update(shopId: string, serviceId: string, dto: UpdateServiceDto): Promise<Service> {
    await this.findOneOrThrow(shopId, serviceId);

    try {
      return await this.prisma.service.update({ where: { id: serviceId }, data: dto });
    } catch (error) {
      throw translateDuplicateName(error);
    }
  }

  /**
   * Deactivates rather than deletes. Bookings (Phase 4) reference a service, and
   * erasing one would rewrite history; an inactive service stops appearing in
   * the catalogue but past bookings still describe what was sold.
   */
  async deactivate(shopId: string, serviceId: string): Promise<Service> {
    await this.findOneOrThrow(shopId, serviceId);

    return this.prisma.service.update({ where: { id: serviceId }, data: { active: false } });
  }
}

/** Turns the unique-index violation into a 409, leaving anything else untouched. */
function translateDuplicateName(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('A service with that name already exists in this shop');
  }

  return error instanceof Error ? error : new Error(String(error));
}
