import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QueueService } from './queue.service';
import { QueueDto } from './queue.types';

@ApiTags('queue')
@ApiBearerAuth()
@Controller('shops/:shopId/queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  @ApiOperation({
    summary: "The shop's queue for a day, with positions",
    description:
      'Customer names are included only for the shop’s own owner and staff. The caller’s ' +
      'own booking is flagged with isYours. Live updates for the same data arrive on the ' +
      '/queue websocket namespace as queue.updated events.',
  })
  @ApiQuery({ name: 'date', required: false, example: '2027-06-16' })
  @ApiOkResponse({ type: QueueDto })
  @ApiBadRequestResponse({ description: 'Malformed or impossible date' })
  @ApiNotFoundResponse({ description: 'Shop not found' })
  find(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('date') date?: string,
  ): Promise<QueueDto> {
    return this.queue.forShop(shopId, user, date);
  }
}
