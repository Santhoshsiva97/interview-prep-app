import type { User } from '../../../generated/prisma/client.js';
import type { UserRole, UserStatus } from '../../../generated/prisma/enums.js';
import type {
  ProfileDetails,
  ResumeInfo,
} from '../../profile/models/profile-response.model.js';

/** Row in the admin user list. */
export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  createdAt: Date;
}

export const toAdminUserSummary = (u: User): AdminUserSummary => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  emailVerifiedAt: u.emailVerifiedAt,
  lastLoginAt: u.lastLoginAt,
  // Only report locks that are still in force.
  lockedUntil:
    u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
  createdAt: u.createdAt,
});

/** GET /admin/users/:id */
export interface AdminUserDetail extends AdminUserSummary {
  failedLoginAttempts: number;
  hasPassword: boolean;
  activeSessions: number;
  suspension: {
    at: Date;
    reason: string | null;
    by: { id: string; name: string } | null;
  } | null;
  profile: ProfileDetails;
  avatarUrl: string | null;
  resume: ResumeInfo | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface KpiWidget<T> {
  /** `coming_soon` until the module that produces the metric exists. */
  status: 'live' | 'coming_soon';
  data: T;
}

/** GET /admin/dashboard */
export interface AdminDashboard {
  users: KpiWidget<{
    totalCandidates: number;
    activeCandidates: number;
    pendingVerification: number;
    suspended: number;
    staff: number;
    newSignups7d: number;
    newSignups30d: number;
  }>;
  /** Step 10 (analytics). */
  engagement: KpiWidget<{ dau: number | null; mau: number | null }>;
  /** Step 11 (payments). */
  subscriptions: KpiWidget<{
    active: number | null;
    revenueThisMonthCents: number | null;
  }>;
  /** Steps 7–10 (exam engine → analytics). */
  testVolume: KpiWidget<{ attempts7d: number | null }>;
}
