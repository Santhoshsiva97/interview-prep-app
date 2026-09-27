import { createBrowserRouter } from 'react-router';
import { AppLayout } from '../components/layout/AppLayout';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AccountPage } from '../pages/AccountPage';
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { SignupPage } from '../pages/auth/SignupPage';
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage';
import { ComingSoonPage } from '../pages/ComingSoonPage';
import { ErrorPage } from '../pages/ErrorPage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';

// Placeholder routes are replaced as each module is built (see PROGRESS_LOG.md).
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'practice', element: <ComingSoonPage title="Practice" /> },
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
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
