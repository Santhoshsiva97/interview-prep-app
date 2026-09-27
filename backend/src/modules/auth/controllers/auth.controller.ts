import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Public } from '../../../common/decorators/public.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import type { EnvVars } from '../../../config/env.validation.js';
import { AuthError } from '../models/auth-error.js';
import type {
  AuthSession,
  IssuedSession,
  PublicUser,
  RequestMeta,
} from '../models/auth-response.model.js';
import {
  EmailDto,
  LoginDto,
  OtpDto,
  RegisterDto,
  ResetPasswordDto,
} from '../models/auth.dto.js';
import { AuthService } from '../services/auth.service.js';

export const REFRESH_COOKIE = 'refresh_token';
/** The refresh cookie is only ever sent to the auth endpoints. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  private readonly cookieBase: CookieOptions;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvVars, true>,
  ) {
    this.cookieBase = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const { email } = await this.auth.register(dto);
    return { email, message: 'Verification code sent to your email.' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: OtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.startSession(
      res,
      await this.auth.verifyEmail(dto, this.meta(req)),
    );
  }

  @Public()
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return {
      message: 'If that account is awaiting verification, a new code was sent.',
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.startSession(res, await this.auth.login(dto, this.meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    try {
      return this.startSession(
        res,
        await this.auth.refresh(this.refreshCookie(req), this.meta(req)),
      );
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieBase);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.refreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieBase);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: EmailDto) {
    await this.auth.forgotPassword(dto.email);
    return {
      message: 'If an account exists for that email, a reset code was sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return { message: 'Password updated. Please log in.' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.auth.me(user.id);
  }

  // Google OAuth2 is deferred (stretch goal) — routes reserved so the
  // frontend/URL contract is stable.
  @Public()
  @Get('google')
  google(): never {
    throw this.googleNotImplemented();
  }

  @Public()
  @Get('google/callback')
  googleCallback(): never {
    throw this.googleNotImplemented();
  }

  private startSession(res: Response, session: IssuedSession): AuthSession {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieBase,
      expires: session.refreshTokenExpiresAt,
    });
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  private refreshCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value ? value : undefined;
  }

  private meta(req: Request): RequestMeta {
    return { userAgent: req.get('user-agent'), ipAddress: req.ip };
  }

  private googleNotImplemented() {
    return new AuthError(
      HttpStatus.NOT_IMPLEMENTED,
      'NOT_IMPLEMENTED',
      'Google sign-in is not available yet.',
    );
  }
}
