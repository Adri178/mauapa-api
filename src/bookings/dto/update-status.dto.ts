import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateBookingStatusDto {
  @ApiProperty({
    enum: BookingStatus,
    description:
      'BOOKED → WAITING → IN_PROGRESS → DONE, with CANCELLED reachable from any of the ' +
      'first three. DONE and CANCELLED are terminal.',
  })
  @IsEnum(BookingStatus)
  status!: BookingStatus;
}
