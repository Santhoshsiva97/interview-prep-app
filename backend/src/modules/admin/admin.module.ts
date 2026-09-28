import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { AdminDashboardController } from './controllers/admin-dashboard.controller.js';
import { AdminUsersController } from './controllers/admin-users.controller.js';
import { AdminDashboardService } from './services/admin-dashboard.service.js';
import { AdminUsersService } from './services/admin-users.service.js';

/** Admin portal API (FRD §4.3), all under /api/v1/admin. */
@Module({
  imports: [AuthModule, ProfileModule, AnalyticsModule],
  controllers: [AdminDashboardController, AdminUsersController],
  providers: [AdminDashboardService, AdminUsersService],
})
export class AdminModule {}
