import type { ReactNode } from 'react';
import styles from './AuthForm.module.css';

interface AuthCardProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <section className={styles.card}>
      <h1 className={styles.title}>{title}</h1>
      {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      {children}
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
}
