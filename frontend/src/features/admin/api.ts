import { apiFetch, apiPatch, apiPost } from '../../lib/api';
import type { UserRole } from '../auth/api';
import type { ProfileDetails, ResumeInfo } from '../profile/api';

// Mirrors backend/src/modules/admin/models/*.

export type UserStatus = 'pending_verification' | 'active' | 'suspended';
export type UserSort = 'newest' | 'oldest' | 'name' | 'last_login';
export type AssignableRole = Exclude<UserRole, 'super_admin'>;
export type StaffRole = Exclude<AssignableRole, 'candidate'>;

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  failedLoginAttempts: number;
  hasPassword: boolean;
  activeSessions: number;
  suspension: {
    at: string;
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
  status: 'live' | 'coming_soon';
  data: T;
}

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
  engagement: KpiWidget<{ dau: number | null; mau: number | null }>;
  subscriptions: KpiWidget<{
    active: number | null;
    revenueThisMonthCents: number | null;
  }>;
  testVolume: KpiWidget<{ attempts7d: number | null }>;
}

export interface UserListQuery {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  scope?: 'all' | 'staff' | 'candidates';
  sort?: UserSort;
  page?: number;
  pageSize?: number;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  phone?: string;
  role: StaffRole;
}

const toQuery = (q: UserListQuery) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return params.toString();
};

const userPath = (id: string, action = '') =>
  `/admin/users/${encodeURIComponent(id)}${action}`;

export const adminApi = {
  dashboard: () => apiFetch<AdminDashboard>('/admin/dashboard'),
  listUsers: (q: UserListQuery) =>
    apiFetch<Paginated<AdminUserSummary>>(`/admin/users?${toQuery(q)}`),
  getUser: (id: string) => apiFetch<AdminUserDetail>(userPath(id)),
  suspend: (id: string, reason: string) =>
    apiPost<AdminUserDetail>(userPath(id, '/suspend'), { reason }),
  reactivate: (id: string) =>
    apiPost<AdminUserDetail>(userPath(id, '/reactivate')),
  forceLogout: (id: string) =>
    apiPost<{ revokedSessions: number }>(userPath(id, '/force-logout')),
  changeRole: (id: string, role: AssignableRole) =>
    apiPatch<AdminUserDetail>(userPath(id, '/role'), { role }),
  createStaff: (input: CreateStaffInput) =>
    apiPost<{ user: AdminUserSummary; message: string }>('/admin/staff', input),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  candidate: 'Candidate',
  editor: 'Editor',
  support: 'Support',
  admin: 'Admin',
  super_admin: 'Super admin',
};

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Active',
  pending_verification: 'Pending verification',
  suspended: 'Suspended',
};

/** Client-side mirror of the API's "who may manage whom" rules (for hiding buttons). */
export function canManage(
  actor: { id: string; role: UserRole },
  target: { id: string; role: UserRole },
): boolean {
  if (actor.id === target.id || target.role === 'super_admin') return false;
  if (target.role !== 'candidate') return actor.role === 'super_admin';
  return actor.role === 'admin' || actor.role === 'super_admin';
}

export const formatDate = (iso: string | null, withTime = false) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        ...(withTime && { timeStyle: 'short' }),
      })
    : '—';
