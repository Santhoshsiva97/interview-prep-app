import { Global, Module } from '@nestjs/common';
import { SessionRevocationService } from './auth/session-revocation.service.js';

/** App-wide services used by the global guards and several feature modules. */
@Global()
@Module({
  providers: [SessionRevocationService],
  exports: [SessionRevocationService],
})
export class CommonModule {}
