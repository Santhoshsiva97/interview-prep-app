import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import styles from './Form.module.css';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  /** Right-aligned note under the field, e.g. a character counter. */
  aside?: ReactNode;
  children: ReactNode;
}

function FieldShell({ id, label, hint, aside, children }: FieldShellProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children}
      {(hint || aside) && (
        <div className={styles.hintRow}>
          <small id={`${id}-hint`} className={styles.hint}>
            {hint}
          </small>
          {aside && <small className={styles.hint}>{aside}</small>}
        </div>
      )}
    </div>
  );
}

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function FormField({ label, hint, ...inputProps }: FormFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
    </FieldShell>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

export function TextAreaField({
  label,
  hint,
  ...textareaProps
}: TextAreaFieldProps) {
  const id = useId();
  const length = String(textareaProps.value ?? '').length;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      aside={
        textareaProps.maxLength
          ? `${length}/${textareaProps.maxLength}`
          : undefined
      }
    >
      <textarea
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...textareaProps}
      />
    </FieldShell>
  );
}

export function FormAlert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={styles[kind]}>
      {children}
    </p>
  );
}
