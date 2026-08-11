import { Module } from '@nestjs/common';
import { ShopOwnershipGuard } from './guards/shop-ownership.guard';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

@Module({
  controllers: [ShopsController],
  providers: [ShopsService, ShopOwnershipGuard],
  // Nested feature modules apply the guard and reuse the ownership check.
  exports: [ShopsService, ShopOwnershipGuard],
})
export class ShopsModule {}
