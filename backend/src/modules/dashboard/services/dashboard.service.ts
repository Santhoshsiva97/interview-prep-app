import { Injectable } from '@nestjs/common';
import { InsightsService } from '../../analytics/services/insights.service.js';
import { ProfileService } from '../../profile/services/profile.service.js';
import { ScorecardService } from '../../scorecards/services/scorecard.service.js';
import type { DashboardResponse } from '../models/dashboard-response.model.js';

@Injectable()
export class DashboardService {
  constructor(
    private readonly profiles: ProfileService,
    private readonly scorecards: ScorecardService,
    private readonly insights: InsightsService,
  ) {}

  /** Candidate dashboard (FRD §4.2). Placeholder widgets keep a stable shape for later steps. */
  async get(userId: string): Promise<DashboardResponse> {
    const { user, completeness } = await this.profiles.get(userId);
    const attempts = await this.scorecards.recent(userId);
    const recommended = await this.insights.recommend(userId);

    return {
      user: { name: user.name },
      profileCompleteness: { status: 'live', data: completeness },
      streak: { status: 'coming_soon', data: null },
      // Step 9: submitted mock tests / interviews, with their result once graded.
      recentActivity: {
        status: 'live',
        data: attempts.map((a) => ({
          id: a.sessionId,
          type: a.kind === 'virtual_interview' ? 'interview' : 'exam',
          title: a.title,
          occurredAt: (a.submittedAt ?? new Date()).toISOString(),
          result: a.result
            ? `${a.result.score} / ${a.result.maxScore} (${Math.round(a.result.percent)}%)`
            : a.gradingStatus === 'failed'
              ? 'Grading delayed'
              : 'Grading…',
        })),
      },
      // Step 10: untaken tests aimed at the candidate's weakest topics.
      recommendedTests: {
        status: 'live',
        data: recommended.map((r) => ({
          id: r.examId,
          title: r.title,
          topic: r.weakTopics.length
            ? `Practises ${r.weakTopics.join(', ')}`
            : `${r.questionCount} questions`,
          difficulty: r.difficulty,
          durationMinutes: r.durationMinutes,
        })),
      },
    };
  }
}
