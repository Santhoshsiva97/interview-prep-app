import type { ReactNode } from 'react';

interface ComingSoonPageProps {
  title: string;
  /** What the page will do once its module is built. */
  description?: ReactNode;
}

/** Placeholder for routes whose backing module hasn't been built yet. */
export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p>{description ?? 'This section is coming soon.'}</p>
      {description && (
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 0 }}>
          Coming soon.
        </p>
      )}
    </section>
  );
}
