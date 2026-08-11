import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';

export class QueueEntryDto {
  @ApiProperty({ format: 'uuid' })
  bookingId!: string;

  @ApiProperty({
    nullable: true,
    example: 1,
    description:
      'Place in the waiting line, 1 = next. Null once the booking is being served, ' +
      'finished, or cancelled — those are no longer waiting for anything.',
  })
  position!: number | null;

  @ApiProperty({ enum: BookingStatus })
  status!: BookingStatus;

  @ApiProperty()
  startTime!: Date;

  @ApiProperty({ format: 'uuid' })
  staffId!: string;

  @ApiProperty({ example: 'Andi' })
  staffName!: string;

  @ApiProperty({ example: 'Potong Rambut' })
  serviceName!: string;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Budi Santoso',
    description: 'Only present for the shop’s own owner and staff; null to customers',
  })
  customerName!: string | null;

  @ApiProperty({ description: "True on the caller's own booking" })
  isYours!: boolean;
}

export class QueueDto {
  @ApiProperty({ format: 'uuid' })
  shopId!: string;

  @ApiProperty({ example: '2027-06-16' })
  date!: string;

  @ApiProperty({ type: [QueueEntryDto] })
  entries!: QueueEntryDto[];
}

/** What a queue row needs before it is shaped for a particular viewer. */
export interface QueueRow {
  bookingId: string;
  status: BookingStatus;
  startTime: Date;
  staffId: string;
  staffName: string;
  serviceName: string;
  customerId: string;
  customerName: string;
}
