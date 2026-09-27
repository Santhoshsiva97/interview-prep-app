import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvVars } from '../../config/env.validation.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { ConsoleOtpSender, OTP_SENDER } from './services/otp-sender.js';
import { OtpService } from './services/otp.service.js';
import { PasswordService } from './services/password.service.js';
import { TokenService } from './services/token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      // Global so the app-wide JwtAuthGuard can verify tokens.
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    PasswordService,
    TokenService,
    // STEP 5 HOOK: replace ConsoleOtpSender with the Mail Module's sender.
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
  ],
  // Used by the admin module: TokenService (force-logout, suspension, role
  // changes) and OtpService (account-setup codes for new staff).
  exports: [TokenService, OtpService],
})
export class AuthModule {}
