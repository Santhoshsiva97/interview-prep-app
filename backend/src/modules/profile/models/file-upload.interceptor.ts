import {
  CallHandler,
  ExecutionContext,
  Injectable,
  mixin,
  NestInterceptor,
  PayloadTooLargeException,
  Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { tooLarge, type UploadRules } from './upload-rules.js';

/**
 * Multipart `file` field, buffered in memory and capped at the rule's size so
 * oversized uploads are rejected while streaming (with our FILE_TOO_LARGE code).
 */
export function FileUploadInterceptor(
  rules: UploadRules,
): Type<NestInterceptor> {
  const Base = FileInterceptor('file', {
    limits: { fileSize: rules.maxBytes, files: 1 },
  });

  @Injectable()
  class RuleBoundFileInterceptor extends Base {
    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await super.intercept(context, next);
      } catch (err) {
        if (err instanceof PayloadTooLargeException) throw tooLarge(rules);
        throw err;
      }
    }
  }
  return mixin(RuleBoundFileInterceptor);
}
