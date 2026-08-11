import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { ServicesModule } from './services/services.module';
import { ShopsModule } from './shops/shops.module';
import { ThrottlingModule } from './throttling/throttling.module';
import { StaffModule } from './staff/staff.module';
import { WorkingHoursModule } from './working-hours/working-hours.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    ThrottlingModule,
    AuthModule,
    ShopsModule,
    ServicesModule,
    StaffModule,
    WorkingHoursModule,
    AvailabilityModule,
    QueueModule,
    BookingsModule,
    HealthModule,
  ],
})
export class AppModule {}
