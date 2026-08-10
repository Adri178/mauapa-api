import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = ctxRequest(context);
    const user = request.user;

    // JwtAuthGuard runs first and would have rejected an anonymous request, so
    // a missing user here means @Roles was put on a @Public route by mistake.
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this resource');
    }

    return true;
  }
}

function ctxRequest(context: ExecutionContext): Request & { user?: AuthenticatedUser } {
  return context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
}
