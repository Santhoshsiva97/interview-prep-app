import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * HTTP error with a machine-readable `code` the frontend can branch on.
 * Body: `{ statusCode, code, message, ...details }`.
 */
export class AppError<Code extends string = string> extends HttpException {
  readonly code: Code;

  constructor(
    status: HttpStatus,
    code: Code,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, code, message, ...details }, status);
    this.code = code;
  }
}
