import { Module } from '@nestjs/common';
import { BookingsController, MyBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingsController, MyBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
