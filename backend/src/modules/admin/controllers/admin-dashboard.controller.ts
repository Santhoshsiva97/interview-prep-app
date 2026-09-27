import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AdminDashboard } from '../models/admin-response.model.js';
import { AdminDashboardService } from '../services/admin-dashboard.service.js';

@Controller('admin/dashboard')
@Roles('admin', 'editor', 'support')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  get(): Promise<AdminDashboard> {
    return this.dashboard.get();
  }
}
