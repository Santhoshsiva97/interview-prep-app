import { createBrowserRouter, Navigate } from 'react-router';
import { AdminLayout } from '../components/layout/AdminLayout';
import { AppLayout } from '../components/layout/AppLayout';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminStaffPage } from '../pages/admin/AdminStaffPage';
import { AdminUserDetailPage } from '../pages/admin/AdminUserDetailPage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { PortalLayout } from '../components/layout/PortalLayout';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { SignupPage } from '../pages/auth/SignupPage';
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { ErrorPage } from '../pages/ErrorPage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DashboardPage } from '../pages/portal/DashboardPage';
import { ProfilePage } from '../pages/portal/ProfilePage';

// Placeholder routes are replaced as each module is built (see PROGRESS_LOG.md).
export const router = createBrowserRouter([
  // Public site + auth screens
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'exams', element: <ComingSoonPage title="Mock Exams" /> },
      {
        path: 'interviews',
        element: <ComingSoonPage title="Virtual Interviews" />,
      },
      { path: 'pricing', element: <ComingSoonPage title="Pricing" /> },

      // Auth (Step 2)
      { path: 'signup', element: <SignupPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },

      { path: '*', element: <NotFoundPage /> },
    ],
  },

  // Admin console (Step 4) — staff only; per-route roles mirror the API's @Roles()
  {
    path: 'admin',
    element: <AdminLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <AdminDashboardPage /> },
      {
        path: 'users',
        element: (
          <RequireAuth roles={['admin', 'support']}>
            <AdminUsersPage />
          </RequireAuth>
        ),
      },
      {
        path: 'users/:id',
        element: (
          <RequireAuth roles={['admin', 'support']}>
            <AdminUserDetailPage />
          </RequireAuth>
        ),
      },
      {
        path: 'staff',
        element: (
          <RequireAuth roles={['super_admin']}>
            <AdminStaffPage />
          </RequireAuth>
        ),
      },
      {
        // Step 7 (exam engine)
        path: 'exams',
        element: (
          <ComingSoonPage
            title="Exam & Template Builder"
            description="Build mock exams and interview templates: sections, question selection, time limits and marking schemes."
          />
        ),
      },
      {
        // Step 11 (payments)
        path: 'plans',
        element: (
          <ComingSoonPage
            title="Plan Configuration"
            description="Create and edit subscription plans, pricing and the premium features each plan unlocks."
          />
        ),
      },
      {
        // Step 11 (payments)
        path: 'transactions',
        element: (
          <ComingSoonPage
            title="Transaction Oversight"
            description="Search payments and subscriptions, check gateway status and review refunds."
          />
        ),
      },
      {
        // Step 12 (advertising)
        path: 'ads',
        element: (
          <ComingSoonPage
            title="Ad Slot Configuration"
            description="Turn ad slots on or off per page and manage ad-free rules for subscribers."
          />
        ),
      },
      {
        // Step 13 (audit log & security)
        path: 'audit-log',
        element: (
          <ComingSoonPage
            title="Audit Log"
            description="A searchable record of privileged admin actions: who did what, and when."
          />
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },

  // Client portal (Step 3) — signed-in users only
  {
    element: <PortalLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'account', element: <Navigate to="/profile" replace /> },
      {
        // Step 6 (question bank) + Step 19 (search & filter)
        path: 'practice',
        element: (
          <ComingSoonPage
            title="Practice Library"
            description="Browse MCQ and coding questions by topic, difficulty and company, and practise at your own pace."
          />
        ),
      },
      {
        // Step 9 (scorecards)
        path: 'history',
        element: (
          <ComingSoonPage
            title="History & Scorecards"
            description="Review past mock exams and interviews, with section-wise scores, time spent and answer review."
          />
        ),
      },
      {
        // Step 6 (question bank) — bookmarking questions
        path: 'bookmarks',
        element: (
          <ComingSoonPage
            title="Bookmarks"
            description="Questions you save while practising will be collected here for quick revision."
          />
        ),
      },
      {
        // Step 11 (payments & subscriptions)
        path: 'subscription',
        element: (
          <ComingSoonPage
            title="Subscription"
            description="View your plan, upgrade for premium tests and ad-free practice, and download invoices."
          />
        ),
      },
    ],
  },
]);
