import type { User } from '../../../generated/prisma/client.js';

/** User fields that are safe to return to the client. */
export type PublicUser = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'phone'
  | 'role'
  | 'status'
  | 'emailVerifiedAt'
  | 'createdAt'
>;

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  status: user.status,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});

/** Body of login / verify-email / refresh responses. */
export interface AuthSession {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: PublicUser;
}

/** Internal: a session plus the raw refresh token to put in the cookie. */
export interface IssuedSession extends AuthSession {
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}
