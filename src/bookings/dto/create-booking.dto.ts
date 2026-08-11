import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffId!: string;

  @ApiProperty({
    example: '2027-06-16T02:00:00.000Z',
    description:
      'Absolute start instant, exactly as returned by the availability endpoint. ' +
      'The end is derived from the service duration and is never supplied by the client.',
  })
  @IsISO8601({ strict: true })
  startTime!: string;
}
