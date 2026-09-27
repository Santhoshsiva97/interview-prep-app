import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../features/auth/api';
import { AuthCard } from '../../features/auth/components/AuthCard';
import styles from '../../features/auth/components/AuthForm.module.css';
import { FormAlert, FormField } from '../../components/form/FormField';
import { homePathFor } from '../../components/layout/portalNav';
import { useAuth } from '../../features/auth/useAuth';
import { ApiError, errorMessage } from '../../lib/api';

interface LoginLocationState {
  from?: string;
  message?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LoginLocationState;
  const { user, startSession } = useAuth();

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Staff land in the admin console, candidates in their portal.
  if (user)
    return <Navigate to={state.from ?? homePathFor(user.role)} replace />;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email')).trim();
    setError('');
    setSubmitting(true);
    try {
      const session = await authApi.login(email, String(form.get('password')));
      startSession(session);
      navigate(state.from ?? homePathFor(session.user.role), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        // A cooldown error just means a code was sent moments ago; it is still valid.
        await authApi.resendVerification(email).catch(() => undefined);
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
          state: { justSent: true },
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') {
        const until = err.detail<string>('lockedUntil');
        setError(
          `Too many failed attempts. Try again after ${
            until ? new Date(until).toLocaleTimeString() : 'a few minutes'
          }, or reset your password.`,
        );
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Log in"
      subtitle="Welcome back."
      footer={
        <>
          New here? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <FormAlert kind="info">{state.message}</FormAlert>
        <FormAlert>{error}</FormAlert>
        <FormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className={styles.row}>
          <span />
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button className={styles.submit} disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthCard>
  );
}
