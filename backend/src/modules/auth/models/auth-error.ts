import { HttpException, HttpStatus } from '@nestjs/common';

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

export class AuthError extends HttpException {
  readonly code: AuthErrorCode;

  constructor(
    status: HttpStatus,
    code: AuthErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, ...details }, status);
    this.code = code;
  }
}
