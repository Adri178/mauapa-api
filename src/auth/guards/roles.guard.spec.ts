import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../auth.types';

function contextWith(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const owner: AuthenticatedUser = { id: 'u1', email: 'o@x.id', role: Role.OWNER };
const customer: AuthenticatedUser = { id: 'u2', email: 'c@x.id', role: Role.CUSTOMER };

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const requireRoles = (roles: Role[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);

  it('allows a route that declares no roles', () => {
    requireRoles(undefined);

    expect(guard.canActivate(contextWith(customer))).toBe(true);
  });

  it('allows a route whose @Roles list is empty', () => {
    requireRoles([]);

    expect(guard.canActivate(contextWith(customer))).toBe(true);
  });

  it('allows a user holding the required role', () => {
    requireRoles([Role.OWNER]);

    expect(guard.canActivate(contextWith(owner))).toBe(true);
  });

  it('allows a user holding one of several accepted roles', () => {
    requireRoles([Role.OWNER, Role.STAFF]);

    expect(guard.canActivate(contextWith({ ...owner, role: Role.STAFF }))).toBe(true);
  });

  it('rejects a user with the wrong role', () => {
    requireRoles([Role.OWNER]);

    expect(() => guard.canActivate(contextWith(customer))).toThrow(ForbiddenException);
  });

  it('rejects when no user is attached', () => {
    requireRoles([Role.OWNER]);

    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
