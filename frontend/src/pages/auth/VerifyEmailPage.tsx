import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../features/auth/api';
import { AuthCard } from '../../features/auth/components/AuthCard';
import styles from '../../features/auth/components/AuthForm.module.css';
import { FormAlert, FormField } from '../../features/auth/components/FormField';
import { otpErrorMessage } from '../../features/auth/errors';
import { useAuth } from '../../features/auth/useAuth';
import { useCooldown } from '../../features/auth/useCooldown';
import { ApiError, errorMessage } from '../../lib/api';

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { startSession } = useAuth();

  // Sign-up and login (unverified account) both send a code before redirecting here.
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [justSent] = useState(
    () =>
      Boolean((location.state as { justSent?: boolean } | null)?.justSent) &&
      !!email,
  );
  const [error, setError] = useState('');
  const [info, setInfo] = useState(() =>
    justSent ? `We sent a 6-digit code to ${email}.` : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, startCooldown] = useCooldown(
    justSent ? RESEND_COOLDOWN_SECONDS : 0,
  );

  async function resend() {
    try {
      await authApi.resendVerification(email);
      setInfo(`We sent a new code to ${email}.`);
      startCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_COOLDOWN') {
        startCooldown(
          err.detail<number>('retryAfterSeconds') ?? RESEND_COOLDOWN_SECONDS,
        );
        setInfo('A code was sent recently — check your inbox.');
      } else {
        setError(errorMessage(err));
      }
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code')).trim();
    setError('');
    setSubmitting(true);
    try {
      startSession(await authApi.verifyEmail(email, code));
      navigate('/account', { replace: true });
    } catch (err) {
      setError(otpErrorMessage(err));
      if (err instanceof ApiError && err.code === 'ALREADY_VERIFIED') {
        navigate('/login', { state: { message: err.message } });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Verify your email"
      subtitle="Enter the 6-digit code we emailed you. It expires in 10 minutes."
      footer={<Link to="/login">Back to log in</Link>}
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <FormAlert>{error}</FormAlert>
        <FormAlert kind="info">{info}</FormAlert>
        <FormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value.trim())}
        />
        <FormField
          label="Verification code"
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
        <button className={styles.submit} disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify email'}
        </button>
        <div className={styles.row}>
          <span>Didn’t get it?</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setError('');
              void resend();
            }}
            disabled={!email || cooldown > 0}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
