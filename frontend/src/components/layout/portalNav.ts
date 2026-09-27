import type { UserRole } from '../../features/auth/api';
import type { IconName } from '../icons/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Placeholder until its module ships. */
  soon?: boolean;
  /** Only match the exact path (for section roots like /admin). */
  end?: boolean;
  /** Roles that see this item (super_admin sees everything). Omit = everyone. */
  roles?: UserRole[];
}

/** Roles allowed into the admin console. */
export const STAFF_ROLES: UserRole[] = ['editor', 'support', 'admin'];

export const isStaff = (role: UserRole) =>
  role === 'super_admin' || STAFF_ROLES.includes(role);

/** Where a user "lives": staff in the admin console, candidates in the portal. */
export const homePathFor = (role: UserRole) =>
  isStaff(role) ? '/admin' : '/dashboard';

// Client portal navigation (FRD §4.2).
export const PORTAL_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/practice', label: 'Practice Library', icon: 'practice', soon: true },
  {
    to: '/history',
    label: 'History & Scorecards',
    icon: 'history',
    soon: true,
  },
  { to: '/bookmarks', label: 'Bookmarks', icon: 'bookmark', soon: true },
  {
    to: '/subscription',
    label: 'Subscription',
    icon: 'subscription',
    soon: true,
  },
  { to: '/profile', label: 'Profile', icon: 'profile' },
];

// Admin console navigation (FRD §4.3). Keep `roles` in sync with the API's @Roles().
export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },
  {
    to: '/admin/users',
    label: 'Users',
    icon: 'users',
    roles: ['admin', 'support'],
  },
  {
    to: '/admin/staff',
    label: 'Staff & Roles',
    icon: 'shield',
    roles: ['super_admin'],
  },
  {
    to: '/admin/questions',
    label: 'Questions',
    icon: 'practice',
    roles: ['editor', 'admin'],
  },
  {
    to: '/admin/taxonomy',
    label: 'Taxonomy',
    icon: 'bookmark',
    roles: ['editor', 'admin'],
  },
  {
    to: '/admin/email',
    label: 'Email',
    icon: 'mail',
    roles: ['admin', 'support'],
  },
  {
    to: '/admin/exams',
    label: 'Exam Builder',
    icon: 'history',
    soon: true,
    roles: ['admin', 'editor'],
  },
  {
    to: '/admin/plans',
    label: 'Plans',
    icon: 'subscription',
    soon: true,
    roles: ['admin'],
  },
  {
    to: '/admin/transactions',
    label: 'Transactions',
    icon: 'receipt',
    soon: true,
    roles: ['admin', 'support'],
  },
  {
    to: '/admin/ads',
    label: 'Ad Slots',
    icon: 'megaphone',
    soon: true,
    roles: ['admin'],
  },
  {
    to: '/admin/audit-log',
    label: 'Audit Log',
    icon: 'history',
    soon: true,
    roles: ['admin'],
  },
];
