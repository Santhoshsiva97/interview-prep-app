import type { ProfileCompleteness } from '../../profile/models/profile-response.model.js';

/**
 * `live` widgets carry real data; `coming_soon` widgets are placeholders whose
 * backing module isn't built yet (the frontend renders an empty state).
 */
export interface DashboardWidget<T> {
  status: 'live' | 'coming_soon';
  data: T;
}

export interface StreakData {
  currentDays: number;
  longestDays: number;
}

export interface ActivityItem {
  id: string;
  type: 'practice' | 'exam' | 'interview';
  title: string;
  occurredAt: string;
  /** e.g. "8/10" or "72%" */
  result?: string;
}

export interface RecommendedTest {
  id: string;
  title: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  durationMinutes: number;
}

/** GET /api/v1/dashboard */
export interface DashboardResponse {
  user: { name: string };
  profileCompleteness: DashboardWidget<ProfileCompleteness>;
  /** Wired in Step 17 (Gamification). */
  streak: DashboardWidget<StreakData | null>;
  /** Wired in Steps 7–9 (exam engine, evaluation, scorecards). */
  recentActivity: DashboardWidget<ActivityItem[]>;
  /** Wired in Steps 6 + 10 (question bank, analytics-driven recommendations). */
  recommendedTests: DashboardWidget<RecommendedTest[]>;
}
