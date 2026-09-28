import { createBrowserRouter, Navigate } from 'react-router';
import { AdminLayout } from '../components/layout/AdminLayout';
import { AppLayout } from '../components/layout/AppLayout';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminEmailPage } from '../pages/admin/AdminEmailPage';
import { AdminStaffPage } from '../pages/admin/AdminStaffPage';
import { AdminUserDetailPage } from '../pages/admin/AdminUserDetailPage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { ExamBuilderPage } from '../pages/admin/exams/ExamBuilderPage';
import { ExamsListPage } from '../pages/admin/exams/ExamsListPage';
import { QuestionEditorPage } from '../pages/admin/questions/QuestionEditorPage';
import { QuestionImportPage } from '../pages/admin/questions/QuestionImportPage';
import { QuestionsListPage } from '../pages/admin/questions/QuestionsListPage';
import { TaxonomyPage } from '../pages/admin/TaxonomyPage';
import { PortalLayout } from '../components/layout/PortalLayout';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { SignupPage } from '../pages/auth/SignupPage';
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { ErrorPage } from '../pages/ErrorPage';
import { ExamRuntimePage } from '../pages/exam/ExamRuntimePage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DashboardPage } from '../pages/portal/DashboardPage';
import { HistoryPage } from '../pages/portal/history/HistoryPage';
import { ScorecardPage } from '../pages/portal/history/ScorecardPage';
import { ProfilePage } from '../pages/portal/ProfilePage';
import { TestInstructionsPage } from '../pages/portal/tests/TestInstructionsPage';
import { TestsPage } from '../pages/portal/tests/TestsPage';

// Placeholder routes are replaced as each module is built (see PROGRESS_LOG.md).
export const router = createBrowserRouter([
  // Public site + auth screens
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      // Step 7: the catalog lives in the portal (sign-in required).
      {
        path: 'exams',
        element: <Navigate to="/tests?kind=mock_exam" replace />,
      },
      {
        path: 'interviews',
        element: <Navigate to="/tests?kind=virtual_interview" replace />,
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
        path: 'email',
        element: (
          <RequireAuth roles={['admin', 'support']}>
            <AdminEmailPage />
          </RequireAuth>
        ),
      },
      // Question bank (Step 6)
      {
        path: 'questions',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <QuestionsListPage />
          </RequireAuth>
        ),
      },
      {
        path: 'questions/new',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <QuestionEditorPage />
          </RequireAuth>
        ),
      },
      {
        path: 'questions/import',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <QuestionImportPage />
          </RequireAuth>
        ),
      },
      {
        path: 'questions/:id',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <QuestionEditorPage />
          </RequireAuth>
        ),
      },
      {
        path: 'taxonomy',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <TaxonomyPage />
          </RequireAuth>
        ),
      },
      // Exam & interview builder (Step 7)
      {
        path: 'exams',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <ExamsListPage />
          </RequireAuth>
        ),
      },
      {
        path: 'exams/new',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <ExamBuilderPage />
          </RequireAuth>
        ),
      },
      {
        path: 'exams/:id',
        element: (
          <RequireAuth roles={['editor', 'admin']}>
            <ExamBuilderPage />
          </RequireAuth>
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

  // Exam runtime (Step 7): full screen, no site chrome
  {
    path: 'exam/:sessionId',
    element: (
      <RequireAuth>
        <ExamRuntimePage />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
  },

  // Client portal (Step 3) — signed-in users only
  {
    element: <PortalLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'account', element: <Navigate to="/profile" replace /> },
      // Mock tests & interviews (Step 7)
      { path: 'tests', element: <TestsPage /> },
      { path: 'tests/:id', element: <TestInstructionsPage /> },
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
      // History & Scorecards (Step 9)
      { path: 'history', element: <HistoryPage /> },
      { path: 'history/:sessionId', element: <ScorecardPage /> },
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
