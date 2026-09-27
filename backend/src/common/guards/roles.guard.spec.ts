import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/enums.js';
import { RolesGuard } from './roles.guard.js';

const contextFor = (role?: UserRole) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { id: 'u1', role } : undefined }),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guardRequiring = (roles?: UserRole[]) =>
    new RolesGuard({
      getAllAndOverride: () => roles,
    } as unknown as Reflector);

  it('allows any authenticated user when no roles are required', () => {
    expect(guardRequiring(undefined).canActivate(contextFor('candidate'))).toBe(
      true,
    );
  });

  it('allows a listed role', () => {
    expect(
      guardRequiring(['admin', 'editor']).canActivate(contextFor('editor')),
    ).toBe(true);
  });

  it('rejects an unlisted role', () => {
    expect(() =>
      guardRequiring(['admin']).canActivate(contextFor('candidate')),
    ).toThrow(ForbiddenException);
  });

  it('always allows super_admin', () => {
    expect(
      guardRequiring(['support']).canActivate(contextFor('super_admin')),
    ).toBe(true);
  });

  it('rejects when there is no user', () => {
    expect(() => guardRequiring(['admin']).canActivate(contextFor())).toThrow(
      ForbiddenException,
    );
  });
});
