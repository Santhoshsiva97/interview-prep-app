import { apiFetch } from '../../lib/api';
import type { ProfileCompleteness } from '../profile/api';

// Mirrors backend/src/modules/dashboard/models/dashboard-response.model.ts

/** `coming_soon` = the backing module isn't built yet; render an empty state. */
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
  result?: string;
}

export interface RecommendedTest {
  id: string;
  title: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  durationMinutes: number;
}

export interface Dashboard {
  user: { name: string };
  profileCompleteness: DashboardWidget<ProfileCompleteness>;
  streak: DashboardWidget<StreakData | null>;
  recentActivity: DashboardWidget<ActivityItem[]>;
  recommendedTests: DashboardWidget<RecommendedTest[]>;
}

export const dashboardApi = {
  get: () => apiFetch<Dashboard>('/dashboard'),
};
