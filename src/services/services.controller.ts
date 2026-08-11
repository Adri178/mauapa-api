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
import { CreateServiceDto } from './dto/create-service.dto';
import { ServiceResponseDto } from './dto/service-response.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
@Roles(Role.OWNER)
@UseGuards(ShopOwnershipGuard)
@Controller('shops/:shopId/services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Post()
  @ApiOperation({ summary: 'Add a service to the shop' })
  @ApiCreatedResponse({ type: ServiceResponseDto })
  @ApiConflictResponse({ description: 'Duplicate service name within the shop' })
  create(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: CreateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.services.create(shopId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the shop's services" })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [ServiceResponseDto] })
  list(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean,
  ): Promise<ServiceResponseDto[]> {
    return this.services.list(shopId, includeInactive ?? false);
  }

  @Get(':serviceId')
  @ApiOperation({ summary: 'Read one service' })
  @ApiOkResponse({ type: ServiceResponseDto })
  findOne(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<ServiceResponseDto> {
    return this.services.findOneOrThrow(shopId, serviceId);
  }

  @Patch(':serviceId')
  @ApiOperation({ summary: 'Update a service' })
  @ApiOkResponse({ type: ServiceResponseDto })
  @ApiConflictResponse({ description: 'Duplicate service name within the shop' })
  update(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ServiceResponseDto> {
    return this.services.update(shopId, serviceId, dto);
  }

  @Delete(':serviceId')
  @ApiOperation({ summary: 'Deactivate a service (kept, so past bookings stay meaningful)' })
  @ApiOkResponse({ type: ServiceResponseDto })
  deactivate(
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<ServiceResponseDto> {
    return this.services.deactivate(shopId, serviceId);
  }
}
