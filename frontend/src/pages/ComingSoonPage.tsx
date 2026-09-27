interface ComingSoonPageProps {
  title: string;
}

/** Placeholder for routes whose backing module hasn't been built yet. */
export function ComingSoonPage({ title }: ComingSoonPageProps) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p>This section is coming soon.</p>
    </section>
  );
}
