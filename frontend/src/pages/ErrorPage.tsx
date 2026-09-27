import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/** Top-level route error boundary (rendered outside the layout shell). */
export function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'An unexpected error occurred.';

  return (
    <main style={{ padding: 32 }}>
      <h1>Something went wrong</h1>
      <p>{message}</p>
      <Link to="/">Back to home</Link>
    </main>
  );
}
