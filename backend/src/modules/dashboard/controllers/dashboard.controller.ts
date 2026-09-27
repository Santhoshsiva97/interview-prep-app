import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import type { DashboardResponse } from '../models/dashboard-response.model.js';
import { DashboardService } from '../services/dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<DashboardResponse> {
    return this.dashboard.get(user.id);
  }
}
