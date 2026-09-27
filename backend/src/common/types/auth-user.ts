import type { UserRole } from '../../generated/prisma/enums.js';

/** Claims carried in the access token. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

/** The authenticated principal attached to `request.user` by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: UserRole;
}
