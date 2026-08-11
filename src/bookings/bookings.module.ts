import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { ShopsModule } from '../shops/shops.module';
import { BookingsController, MyBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [ShopsModule, QueueModule],
  controllers: [BookingsController, MyBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
