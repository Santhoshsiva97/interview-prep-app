import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { SessionRevocationService } from '../auth/session-revocation.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AccessTokenPayload } from '../types/auth-user.js';

/**
 * Global guard (registered in AppModule): every route requires a valid
 * `Authorization: Bearer <access token>` unless marked @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly revocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // Force-logout / suspension / role change invalidate tokens immediately.
    const issuedAtMs = payload.iatMs ?? (payload.iat ?? 0) * 1000;
    if (await this.revocation.isRevoked(payload.sub, issuedAtMs)) {
      throw new UnauthorizedException('Session has been revoked');
    }
    request.user = { id: payload.sub, role: payload.role };
    return true;
  }
}
