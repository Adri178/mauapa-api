import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopOwnershipGuard } from '../shops/guards/shop-ownership.guard';
import { SetWorkingHoursDto, WorkingHoursResponseDto } from './dto/working-hours.dto';
import { WorkingHoursService } from './working-hours.service';

@ApiTags('working-hours')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
@Roles(Role.OWNER)
@UseGuards(ShopOwnershipGuard)
@Controller('shops/:shopId/working-hours')
export class WorkingHoursController {
  constructor(private readonly workingHours: WorkingHoursService) {}

  @Get()
  @ApiOperation({ summary: "The shop's opening hours; missing days are closed" })
  @ApiOkResponse({ type: [WorkingHoursResponseDto] })
  list(@Param('shopId', ParseUUIDPipe) shopId: string): Promise<WorkingHoursResponseDto[]> {
    return this.workingHours.list(shopId);
  }

  @Put()
  @ApiOperation({ summary: 'Replace the whole weekly schedule' })
  @ApiOkResponse({ type: [WorkingHoursResponseDto] })
  @ApiBadRequestResponse({ description: 'Duplicate day, or close not after open' })
  replace(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: SetWorkingHoursDto,
  ): Promise<WorkingHoursResponseDto[]> {
    return this.workingHours.replace(shopId, dto);
  }
}
