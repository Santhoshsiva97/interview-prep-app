import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { PlatformAnalyticsService } from '../../analytics/services/platform-analytics.service.js';
import type { AdminDashboard } from '../models/admin-response.model.js';

const DAY_MS = 86_400_000;

/**
 * Admin dashboard KPIs (FRD §4.3 / §4.9). Users, engagement and test volume
 * are live; subscriptions keep a stable `{ status, data }` shape until
 * payments (Step 11) exist.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: PlatformAnalyticsService,
  ) {}

  async get(): Promise<AdminDashboard> {
    const now = Date.now();
    const candidates = { deletedAt: null, role: 'candidate' as const };
    const [
      totalCandidates,
      activeCandidates,
      pendingVerification,
      suspended,
      staff,
      newSignups7d,
      newSignups30d,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: candidates }),
      this.prisma.user.count({ where: { ...candidates, status: 'active' } }),
      this.prisma.user.count({
        where: { ...candidates, status: 'pending_verification' },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, status: 'suspended' },
      }),
      this.prisma.user.count({
        where: { deletedAt: null, role: { not: 'candidate' } },
      }),
      this.prisma.user.count({
        where: {
          ...candidates,
          createdAt: { gte: new Date(now - 7 * DAY_MS) },
        },
      }),
      this.prisma.user.count({
        where: {
          ...candidates,
          createdAt: { gte: new Date(now - 30 * DAY_MS) },
        },
      }),
    ]);
    const k = await this.analytics.kpis();

    return {
      users: {
        status: 'live',
        data: {
          totalCandidates,
          activeCandidates,
          pendingVerification,
          suspended,
          staff,
          newSignups7d,
          newSignups30d,
        },
      },
      engagement: {
        status: 'live',
        data: {
          dau: k.dau,
          wau: k.wau,
          mau: k.mau,
          stickiness: k.stickinessBp / 100,
        },
      },
      subscriptions: {
        status: 'coming_soon',
        data: { active: null, revenueThisMonthCents: null },
      },
      testVolume: {
        status: 'live',
        data: {
          attempts7d: k.attempts7d,
          attempts30d: k.attempts30d,
          graded30d: k.graded30d,
          avgPercent30d: k.avgPercent30d,
        },
      },
    };
  }
}
