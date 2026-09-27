import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './AuthForm.module.css';

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function FormField({ label, hint, ...inputProps }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        {...inputProps}
      />
      {hint && (
        <small id={hintId} className={styles.hint}>
          {hint}
        </small>
      )}
    </div>
  );
}

export function FormAlert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={kind === 'error' ? styles.error : styles.info}
    >
      {children}
    </p>
  );
}
