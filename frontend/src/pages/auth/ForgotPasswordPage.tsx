import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { authApi } from '../../features/auth/api';
import { AuthCard } from '../../features/auth/components/AuthCard';
import styles from '../../features/auth/components/AuthForm.module.css';
import { FormAlert, FormField } from '../../components/form/FormField';
import { otpErrorMessage } from '../../features/auth/errors';
import { useCooldown } from '../../features/auth/useCooldown';
import { errorMessage } from '../../lib/api';

const RESEND_COOLDOWN_SECONDS = 60;

/** Two steps on one route: request a code, then set a new password with it. */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  async function requestCode() {
    await authApi.forgotPassword(email);
    startCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function handleRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await requestCode();
      setStep('reset');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    setSubmitting(true);
    try {
      const { message } = await authApi.resetPassword(
        email,
        String(form.get('code')).trim(),
        String(form.get('newPassword')),
      );
      navigate('/login', { replace: true, state: { message } });
    } catch (err) {
      setError(otpErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'request') {
    return (
      <AuthCard
        title="Reset your password"
        subtitle="Enter your account email and we’ll send you a 6-digit code."
        footer={<Link to="/login">Back to log in</Link>}
      >
        <form className={styles.form} onSubmit={handleRequest}>
          <FormAlert>{error}</FormAlert>
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
          />
          <button className={styles.submit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset code'}
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={
        <>
          If an account exists for <strong>{email}</strong>, we sent it a code.
        </>
      }
      footer={<Link to="/login">Back to log in</Link>}
    >
      <form className={styles.form} onSubmit={handleReset}>
        <FormAlert>{error}</FormAlert>
        <FormField
          label="Reset code"
          name="code"
          className={styles.codeInput}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          title="6-digit code"
          required
          autoFocus
        />
        <FormField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters, with a letter and a number."
        />
        <button className={styles.submit} disabled={submitting}>
          {submitting ? 'Updating…' : 'Update password'}
        </button>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setStep('request')}
          >
            Use a different email
          </button>
          <button
            type="button"
            className={styles.linkButton}
            disabled={cooldown > 0}
            onClick={() =>
              void requestCode().catch((err) => setError(errorMessage(err)))
            }
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
