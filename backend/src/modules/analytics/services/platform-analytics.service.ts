import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';

const DAY_MS = 86_400_000;

export interface DailyPoint {
  /** UTC day, YYYY-MM-DD */
  day: string;
  signups: number;
  activeUsers: number;
  attemptsStarted: number;
  attemptsSubmitted: number;
  /** Average percentage of attempts graded that day (null if none). */
  avgPercent: number | null;
}

/**
 * Platform KPIs for the admin dashboard (FRD §4.9).
 *
 * "Active user" = a candidate with a session token issued that day: every
 * login and every access-token refresh (≤ 15 min apart while the app is
 * open) writes a `refresh_tokens` row, so no separate tracking is needed.
 * Days are UTC.
 */
@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline numbers (also used by GET /admin/dashboard). */
  async kpis(now = new Date()) {
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    // Sequential on purpose: a handful of cheap queries, one connection.
    const dau = await this.activeUsers(since(1), now);
    const wau = await this.activeUsers(since(7), now);
    const mau = await this.activeUsers(since(30), now);
    const attempts7d = await this.prisma.examSession.count({
      where: { startedAt: { gte: since(7) }, deletedAt: null },
    });
    const attempts30d = await this.prisma.examSession.count({
      where: { startedAt: { gte: since(30) }, deletedAt: null },
    });
    const graded30d = await this.prisma.scorecard.aggregate({
      where: { submittedAt: { gte: since(30) }, deletedAt: null },
      _count: { _all: true },
      _avg: { percentBp: true },
    });
    return {
      dau,
      wau,
      mau,
      /** DAU / MAU in basis points: how "sticky" the product is. */
      stickinessBp: mau ? Math.round((dau * 10_000) / mau) : 0,
      attempts7d,
      attempts30d,
      graded30d: graded30d._count._all,
      avgPercent30d:
        graded30d._avg.percentBp === null
          ? null
          : Math.round(graded30d._avg.percentBp) / 100,
    };
  }

  /** One row per UTC day for the last `days` days (oldest first), zero-filled. */
  async daily(days: number, now = new Date()): Promise<DailyPoint[]> {
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const start = new Date(end.getTime() - (days - 1) * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      {
        day: Date;
        signups: number;
        active: number;
        started: number;
        submitted: number;
        avg_bp: number | null;
      }[]
    >`
      WITH days AS (
        SELECT generate_series(${start}::date, ${end}::date, interval '1 day')::date AS day
      )
      SELECT
        d.day,
        (SELECT count(*)::int FROM users u
          WHERE u.role = 'candidate' AND u.deleted_at IS NULL
            AND (u.created_at AT TIME ZONE 'UTC')::date = d.day) AS signups,
        (SELECT count(DISTINCT t.user_id)::int FROM refresh_tokens t
          JOIN users u ON u.id = t.user_id AND u.role = 'candidate'
          WHERE (t.created_at AT TIME ZONE 'UTC')::date = d.day) AS active,
        (SELECT count(*)::int FROM exam_sessions s
          WHERE s.deleted_at IS NULL
            AND (s.started_at AT TIME ZONE 'UTC')::date = d.day) AS started,
        (SELECT count(*)::int FROM exam_sessions s
          WHERE s.deleted_at IS NULL AND s.status = 'submitted'
            AND (s.submitted_at AT TIME ZONE 'UTC')::date = d.day) AS submitted,
        (SELECT avg(c.percent_bp)::float FROM scorecards c
          WHERE c.deleted_at IS NULL
            AND (c.submitted_at AT TIME ZONE 'UTC')::date = d.day) AS avg_bp
      FROM days d
      ORDER BY d.day`;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      signups: r.signups,
      activeUsers: r.active,
      attemptsStarted: r.started,
      attemptsSubmitted: r.submitted,
      avgPercent: r.avg_bp === null ? null : Math.round(r.avg_bp) / 100,
    }));
  }

  private async activeUsers(from: Date, to: Date) {
    const [row] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT t.user_id)::int AS n
      FROM refresh_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.role = 'candidate' AND u.deleted_at IS NULL
        AND t.created_at >= ${from} AND t.created_at <= ${to}`;
    return row.n;
  }
}
