import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { AvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';

/**
 * Not owner-scoped: customers are the main audience, so this sits outside
 * ShopOwnershipGuard. It is still authenticated, and it reveals nothing beyond
 * when a shop can take a booking.
 */
@ApiTags('availability')
@ApiBearerAuth()
@Controller('shops/:shopId/availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Free start times for a service and staff member on a date' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiBadRequestResponse({ description: 'Malformed or impossible date' })
  @ApiNotFoundResponse({ description: 'Unknown shop, or service/staff not in this shop' })
  find(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.find(shopId, query);
  }
}
