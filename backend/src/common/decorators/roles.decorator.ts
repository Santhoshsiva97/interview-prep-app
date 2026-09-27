import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or controller) to the given roles. `super_admin` is
 * always allowed, so it never needs to be listed.
 *
 * @example @Roles('admin', 'editor')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
