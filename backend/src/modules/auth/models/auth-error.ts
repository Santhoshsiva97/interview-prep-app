import { AppError } from '../../../common/errors/app-error.js';

/** Machine-readable codes the frontend can branch on (`body.code`). */
export type AuthErrorCode =
  | 'EMAIL_TAKEN'
  | 'ALREADY_VERIFIED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'OTP_COOLDOWN'
  | 'REFRESH_TOKEN_INVALID'
  | 'NOT_IMPLEMENTED';

export class AuthError extends AppError<AuthErrorCode> {}
