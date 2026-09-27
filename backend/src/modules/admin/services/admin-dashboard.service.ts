import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { AdminDashboard } from '../models/admin-response.model.js';

const DAY_MS = 86_400_000;

/**
 * Admin dashboard KPIs (FRD §4.3). User counts are live; the rest keep a
 * stable `{ status, data }` shape until Steps 7–11 produce the data.
 */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

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
      engagement: { status: 'coming_soon', data: { dau: null, mau: null } },
      subscriptions: {
        status: 'coming_soon',
        data: { active: null, revenueThisMonthCents: null },
      },
      testVolume: { status: 'coming_soon', data: { attempts7d: null } },
    };
  }
}
