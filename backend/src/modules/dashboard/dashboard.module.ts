import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module.js';
import { DashboardController } from './controllers/dashboard.controller.js';
import { DashboardService } from './services/dashboard.service.js';

@Module({
  imports: [ProfileModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
