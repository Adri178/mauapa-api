import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopOwnershipGuard } from '../shops/guards/shop-ownership.guard';
import { CreateStaffDto } from './dto/create-staff.dto';
import { StaffResponseDto } from './dto/staff-response.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
@Roles(Role.OWNER)
@UseGuards(ShopOwnershipGuard)
@Controller('shops/:shopId/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @ApiOperation({ summary: 'Add a staff member, optionally provisioning their login' })
  @ApiCreatedResponse({ type: StaffResponseDto })
  @ApiConflictResponse({ description: 'Email already registered' })
  create(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staff.create(shopId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the shop's staff" })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [StaffResponseDto] })
  list(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<StaffResponseDto[]> {
    return this.staff.list(shopId, includeInactive ?? false);
  }

  @Get(':staffId')
  @ApiOperation({ summary: 'Read one staff member' })
  @ApiOkResponse({ type: StaffResponseDto })
  findOne(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ): Promise<StaffResponseDto> {
    return this.staff.findOneOrThrow(shopId, staffId);
  }

  @Patch(':staffId')
  @ApiOperation({ summary: 'Update a staff member' })
  @ApiOkResponse({ type: StaffResponseDto })
  update(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffResponseDto> {
    return this.staff.update(shopId, staffId, dto);
  }

  @Delete(':staffId')
  @ApiOperation({ summary: 'Deactivate a staff member (kept, so past bookings stay meaningful)' })
  @ApiOkResponse({ type: StaffResponseDto })
  deactivate(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('staffId', ParseUUIDPipe) staffId: string,
  ): Promise<StaffResponseDto> {
    return this.staff.deactivate(shopId, staffId);
  }
}
