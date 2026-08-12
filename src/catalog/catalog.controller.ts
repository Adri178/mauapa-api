import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { PaginatedShopsDto, PublicShopDetailDto, ShopSearchQueryDto } from './dto/public-shop.dto';

/**
 * The only part of the API a visitor can read without an account.
 *
 * Everything here is deliberately shallow: what a shop sells, who works there,
 * when it opens. Nothing that belongs to the shop's own operation — bookings,
 * customers, staff logins, the owner — is reachable from these routes.
 */
@ApiTags('catalog')
@Public()
@Controller('public/shops')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({
    summary: 'Browse shops, no account required',
    description:
      'Free-text search over name and address. openNow is judged by each shop’s own ' +
      'time zone, so a directory spanning zones stays truthful.',
  })
  @ApiOkResponse({ type: PaginatedShopsDto })
  search(@Query() query: ShopSearchQueryDto): Promise<PaginatedShopsDto> {
    return this.catalog.search(query);
  }

  @Get(':shopId')
  @ApiOperation({
    summary: 'One shop with its active services, staff, and opening hours',
    description: 'Everything the slot picker needs, in one request.',
  })
  @ApiOkResponse({ type: PublicShopDetailDto })
  @ApiNotFoundResponse({ description: 'No such shop' })
  findOne(@Param('shopId', ParseUUIDPipe) shopId: string): Promise<PublicShopDetailDto> {
    return this.catalog.findOne(shopId);
  }
}
