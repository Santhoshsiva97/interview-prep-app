import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>Page not found</h1>
      <p>The page you’re looking for doesn’t exist.</p>
      <Link to="/">Back to home</Link>
    </section>
  );
}
