import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '@prisma/client';
import { PageMetaDto } from '../../common/pagination.dto';

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

/**
 * A booking as it appears in the customer's own list.
 *
 * Carries the names alongside the ids: a row reading "Potong Rambut at
 * Barbershop Pak Budi" is useful, and a row of three UUIDs is not — without
 * these a client would fan out to three endpoints to render one line.
 */
export class MyBookingDto extends BookingResponseDto {
  @ApiProperty({ example: 'Barbershop Pak Budi' })
  shopName!: string;

  @ApiProperty({ example: 'Asia/Jakarta' })
  shopTimezone!: string;

  @ApiProperty({ example: 'Potong Rambut Pria' })
  serviceName!: string;

  @ApiProperty({ example: 30 })
  durationMinutes!: number;

  @ApiProperty({ example: 35000 })
  price!: number;

  @ApiProperty({ example: 'Andi' })
  staffName!: string;
}

export class PaginatedMyBookingsDto {
  @ApiProperty({ type: [MyBookingDto] })
  data!: MyBookingDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}

export class PaginatedBookingsDto {
  @ApiProperty({ type: [BookingResponseDto] })
  data!: BookingResponseDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
