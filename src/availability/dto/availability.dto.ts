import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffId!: string;

  @ApiProperty({ example: '2026-08-12', description: 'Calendar date in the shop’s time zone' })
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date!: string;
}

export class SlotDto {
  @ApiProperty({ example: '2026-08-12T02:00:00.000Z', description: 'Absolute start instant' })
  start!: string;

  @ApiProperty({ example: '2026-08-12T02:30:00.000Z', description: 'Absolute end instant' })
  end!: string;

  @ApiProperty({ example: '09:00', description: 'Start as the shop’s wall clock reads it' })
  startLocal!: string;
}

export class AvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ example: '2026-08-12' })
  date!: string;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty({ example: 30 })
  durationMinutes!: number;

  @ApiProperty({ description: 'False when the shop has no opening hours for this weekday' })
  open!: boolean;

  @ApiProperty({ type: [SlotDto] })
  slots!: SlotDto[];
}
