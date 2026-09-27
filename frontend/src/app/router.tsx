import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
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
