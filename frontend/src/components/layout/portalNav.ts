import type { IconName } from '../icons/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  soon?: boolean;
}

// Client portal navigation (FRD §4.2). `soon` = placeholder until its module ships.
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
