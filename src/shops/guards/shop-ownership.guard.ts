import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { ShopsService } from '../shops.service';

/**
 * Applied to every route nested under /shops/:shopId. Verifying ownership here
 * means a controller can never forget to do it, and the shop is resolved once
 * and reused rather than re-fetched by each handler.
 */
@Injectable()
export class ShopOwnershipGuard implements CanActivate {
  constructor(private readonly shops: ShopsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; shop?: unknown }>();

    const shopId = request.params.shopId;
    const user = request.user;

    // Express types a route param as string | string[]; only the string form can
    // be a shop id, and ParseUUIDPipe on the handler rejects malformed ones.
    if (!user || typeof shopId !== 'string') {
      return false;
    }

    // Throws 404 when the shop is missing *or* owned by someone else.
    request.shop = await this.shops.findOwnedOrThrow(shopId, user.id);

    return true;
  }
}
