import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type Staff } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateStaffDto } from './dto/create-staff.dto';
import type { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async create(shopId: string, dto: CreateStaffDto): Promise<Staff> {
    const { name, active, email, password } = dto;

    if (!email || !password) {
      return this.prisma.staff.create({ data: { shopId, name, active } });
    }

    const passwordHash = await this.passwords.hash(password);

    try {
      // One transaction: a staff row without its promised login, or an orphan
      // user with no staff row, would both be worse than failing outright.
      return await this.prisma.staff.create({
        data: {
          // `connect` rather than a bare shopId: Prisma will not mix a raw
          // foreign key with a nested create in the same call.
          shop: { connect: { id: shopId } },
          name,
          active,
          user: { create: { email, name, role: Role.STAFF, passwordHash } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with that email already exists');
      }
      throw error;
    }
  }

  list(shopId: string, includeInactive: boolean): Promise<Staff[]> {
    return this.prisma.staff.findMany({
      where: { shopId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  /** Pairs the row id with shopId, so another tenant's staff simply does not exist. */
  async findOneOrThrow(shopId: string, staffId: string): Promise<Staff> {
    const staff = await this.prisma.staff.findFirst({ where: { id: staffId, shopId } });

    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }

    return staff;
  }

  async update(shopId: string, staffId: string, dto: UpdateStaffDto): Promise<Staff> {
    await this.findOneOrThrow(shopId, staffId);

    return this.prisma.staff.update({ where: { id: staffId }, data: dto });
  }

  /**
   * Deactivates rather than deletes, for the same reason services are: bookings
   * name a staff member, and past bookings should keep saying who did the work.
   */
  async deactivate(shopId: string, staffId: string): Promise<Staff> {
    await this.findOneOrThrow(shopId, staffId);

    return this.prisma.staff.update({ where: { id: staffId }, data: { active: false } });
  }
}
