import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Global guard (runs after JwtAuthGuard): enforces @Roles(...). Routes without
 * @Roles are open to any authenticated user; super_admin passes every check.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<Request>();
    if (user && (user.role === 'super_admin' || required.includes(user.role))) {
      return true;
    }
    throw new ForbiddenException('Insufficient role');
  }
}
