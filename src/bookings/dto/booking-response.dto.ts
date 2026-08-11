import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';

export class BookingResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ format: 'uuid' })
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ format: 'uuid' })
  customerId!: string;

  @ApiProperty({ example: '2027-06-16T02:00:00.000Z' })
  startTime!: Date;

  @ApiProperty({ example: '2027-06-16T02:30:00.000Z' })
  endTime!: Date;

  @ApiProperty({ enum: BookingStatus })
  status!: BookingStatus;

  @ApiProperty()
  createdAt!: Date;
}
