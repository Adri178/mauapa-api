import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateShopDto } from './dto/create-shop.dto';
import { ShopResponseDto } from './dto/shop-response.dto';
import { UpdateShopDto } from './dto/update-shop.dto';
import { ShopsService } from './shops.service';

@ApiTags('shops')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Authenticated but not an owner' })
@Roles(Role.OWNER)
@Controller('shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a shop owned by the caller' })
  @ApiCreatedResponse({ type: ShopResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateShopDto,
  ): Promise<ShopResponseDto> {
    return this.shops.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's own shops" })
  @ApiOkResponse({ type: [ShopResponseDto] })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ShopResponseDto[]> {
    return this.shops.listForOwner(user.id);
  }

  @Get(':shopId')
  @ApiOperation({ summary: 'Read one owned shop' })
  @ApiOkResponse({ type: ShopResponseDto })
  @ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<ShopResponseDto> {
    return this.shops.findOwnedOrThrow(shopId, user.id);
  }

  @Patch(':shopId')
  @ApiOperation({ summary: 'Update an owned shop' })
  @ApiOkResponse({ type: ShopResponseDto })
  @ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseUUIDPipe) shopId: string,
    @Body() dto: UpdateShopDto,
  ): Promise<ShopResponseDto> {
    return this.shops.update(shopId, user.id, dto);
  }

  @Delete(':shopId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an owned shop and everything under it' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'No such shop, or it belongs to another owner' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId', ParseUUIDPipe) shopId: string,
  ): Promise<void> {
    return this.shops.remove(shopId, user.id);
  }
}
