import type { UserRole } from '../../generated/prisma/enums.js';

/** Claims carried in the access token. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  /**
   * Issued-at in milliseconds. The standard `iat` claim has 1 s resolution,
   * too coarse for revocation checks (a token minted in the same second as a
   * force-logout would survive it).
   */
  iatMs: number;
  /** Issued-at (seconds), added by the JWT library. */
  iat?: number;
}

/** The authenticated principal attached to `request.user` by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  role: UserRole;
}
