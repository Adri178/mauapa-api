import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { QueueController } from './queue.controller';
import { QueueGateway } from './queue.gateway';
import { QueueService } from './queue.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [QueueController],
  providers: [QueueService, QueueGateway],
  // BookingsModule broadcasts through the gateway after it changes something.
  exports: [QueueService, QueueGateway],
})
export class QueueModule {}
