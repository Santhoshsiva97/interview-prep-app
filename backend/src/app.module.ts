import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { envValidationSchema } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ExamsModule } from './modules/exams/exams.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { JudgeWorkerModule } from './modules/judge/judge-worker.module.js';
import { JudgeModule } from './modules/judge/judge.module.js';
import { MailWorkerModule } from './modules/mail/mail-worker.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { ProfileModule } from './modules/profile/profile.module.js';
import { ScorecardsModule } from './modules/scorecards/scorecards.module.js';
import { QuestionBankModule } from './modules/question-bank/question-bank.module.js';
import { QueueModule } from './queue/queue.module.js';
import { StorageModule } from './storage/storage.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Real env vars (e.g. from Docker Compose) take precedence over .env.
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    DatabaseModule,
    CommonModule,
    StorageModule,
    QueueModule,
    MailModule,
    ConditionalModule.registerWhen(
      MailWorkerModule,
      (env) => env.MAIL_WORKER_ENABLED !== 'false',
    ),
    AuthModule,
    HealthModule,
    ProfileModule,
    DashboardModule,
    AdminModule,
    QuestionBankModule,
    ExamsModule,
    JudgeModule,
    ScorecardsModule,
    ConditionalModule.registerWhen(
      JudgeWorkerModule,
      (env) => env.JUDGE_WORKER_ENABLED !== 'false',
    ),
  ],
  providers: [
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
