import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { authApi } from '../../features/auth/api';
import { AuthCard } from '../../features/auth/components/AuthCard';
import styles from '../../features/auth/components/AuthForm.module.css';
import { FormAlert, FormField } from '../../features/auth/components/FormField';
import { errorMessage } from '../../lib/api';

export function SignupPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError('');
    setSubmitting(true);
    try {
      const { email } = await authApi.register({
        name: String(form.get('name')),
        email: String(form.get('email')),
        phone: String(form.get('phone')).replace(/[\s-]/g, ''),
        password: String(form.get('password')),
      });
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, {
        state: { justSent: true },
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start practicing for your next interview."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={handleSubmit}>
        <FormAlert>{error}</FormAlert>
        <FormField
          label="Full name"
          name="name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
        />
        <FormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <FormField
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+919876543210"
          hint="Include your country code."
          required
        />
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          hint="At least 8 characters, with a letter and a number."
        />
        <button className={styles.submit} disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
