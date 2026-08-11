import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SetWorkingHoursDto, WorkingHoursResponseDto } from './dto/working-hours.dto';

/** "09:30" → 570. Format is already validated by the DTO. */
export function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

/** 570 → "09:30" */
export function toHhMm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

@Injectable()
export class WorkingHoursService {
  constructor(private readonly prisma: PrismaService) {}

  async list(shopId: string): Promise<WorkingHoursResponseDto[]> {
    const rows = await this.prisma.workingHours.findMany({
      where: { shopId },
      orderBy: { dayOfWeek: 'asc' },
    });

    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      open: toHhMm(row.openMinute),
      close: toHhMm(row.closeMinute),
    }));
  }

  async replace(shopId: string, dto: SetWorkingHoursDto): Promise<WorkingHoursResponseDto[]> {
    const entries = dto.hours.map((entry) => ({
      dayOfWeek: entry.dayOfWeek,
      openMinute: toMinutes(entry.open),
      closeMinute: toMinutes(entry.close),
    }));

    for (const entry of entries) {
      if (entry.closeMinute <= entry.openMinute) {
        throw new BadRequestException(
          `close must be after open for day ${entry.dayOfWeek} (overnight hours are not supported)`,
        );
      }
    }

    const days = entries.map((entry) => entry.dayOfWeek);
    if (new Set(days).size !== days.length) {
      throw new BadRequestException('each day of the week may appear at most once');
    }

    // Delete-then-insert inside one transaction: a caller that sends a shorter
    // week must not briefly appear to be open on days it just dropped.
    await this.prisma.$transaction([
      this.prisma.workingHours.deleteMany({ where: { shopId } }),
      this.prisma.workingHours.createMany({
        data: entries.map((entry) => ({ ...entry, shopId })),
      }),
    ]);

    return this.list(shopId);
  }
}
