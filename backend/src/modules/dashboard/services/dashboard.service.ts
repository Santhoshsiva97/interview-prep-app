import { Injectable } from '@nestjs/common';
import { ProfileService } from '../../profile/services/profile.service.js';
import type { DashboardResponse } from '../models/dashboard-response.model.js';

@Injectable()
export class DashboardService {
  constructor(private readonly profiles: ProfileService) {}

  /** Candidate dashboard (FRD §4.2). Placeholder widgets keep a stable shape for later steps. */
  async get(userId: string): Promise<DashboardResponse> {
    const { user, completeness } = await this.profiles.get(userId);

    return {
      user: { name: user.name },
      profileCompleteness: { status: 'live', data: completeness },
      streak: { status: 'coming_soon', data: null },
      recentActivity: { status: 'coming_soon', data: [] },
      recommendedTests: { status: 'coming_soon', data: [] },
    };
  }
}
