import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/icons/Icon';
import btn from '../../components/ui/Button.module.css';
import { formatDate, type Paginated } from '../../features/admin/api';
import {
  MAIL_STATUS_LABELS,
  mailApi,
  TEMPLATE_LABELS,
  type MailRecord,
  type MailStatus,
  type MailTemplateInfo,
} from '../../features/admin/mailApi';
import { errorMessage } from '../../lib/api';
import styles from './Admin.module.css';

const STATUS_TONE: Record<MailStatus, string | undefined> = {
  queued: undefined,
  sending: 'primary',
  retrying: 'primary',
  sent: 'success',
  failed: 'danger',
};

/** Email delivery log + template previews (FRD §4.5). */
export function AdminEmailPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'templates' ? 'templates' : 'log';

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Email</h1>
        <p className={styles.subtitle}>
          Every email the platform sends, with its delivery status. Message
          bodies are never stored.
        </p>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Email views">
        {(['log', 'templates'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? styles.tabActive : styles.tab}
            onClick={() => setParams(t === 'log' ? {} : { tab: t })}
          >
            {t === 'log' ? 'Delivery log' : 'Templates'}
          </button>
        ))}
      </div>
      {tab === 'log' ? <DeliveryLog /> : <TemplatePreviews />}
    </div>
  );
}

function DeliveryLog() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<{
    search: string;
    status: MailStatus | '';
    page: number;
  }>({
    search: '',
    status: '',
    page: 1,
  });
  const [result, setResult] = useState<Paginated<MailRecord> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(
      () =>
        setQuery((q) => (q.search === search ? q : { ...q, search, page: 1 })),
      300,
    );
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    mailApi
      .list({
        search: query.search,
        status: query.status || undefined,
        page: query.page,
      })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError('');
      })
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <>
      <div className={styles.filters} role="search">
        <div className={styles.searchBox}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            type="search"
            placeholder="Search recipient email"
            aria-label="Search recipient email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.select}
          aria-label="Filter by status"
          value={query.status}
          onChange={(e) =>
            setQuery((q) => ({
              ...q,
              status: e.target.value as MailStatus | '',
              page: 1,
            }))
          }
        >
          <option value="">All statuses</option>
          {Object.entries(MAIL_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}
      {!result && !error && <p aria-busy="true">Loading…</p>}
      {result &&
        (result.items.length === 0 ? (
          <div className={`${styles.card} ${styles.empty}`}>
            <p className={styles.muted}>No emails match these filters.</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Recipient</th>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Queued</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className={styles.userCell}>
                      <strong>{m.toAddress}</strong>
                      <span>{m.subject}</span>
                    </div>
                  </td>
                  <td data-label="Email">
                    {TEMPLATE_LABELS[m.template] ?? m.template}
                  </td>
                  <td data-label="Status">
                    <span
                      className={styles.badge}
                      data-tone={STATUS_TONE[m.status]}
                      title={m.lastError ?? undefined}
                    >
                      {MAIL_STATUS_LABELS[m.status]}
                    </span>
                    {m.lastError && m.status !== 'sent' && (
                      <div className={styles.errorNote}>{m.lastError}</div>
                    )}
                  </td>
                  <td data-label="Attempts">
                    {m.attempts}/{m.maxAttempts}
                  </td>
                  <td data-label="Queued">
                    {formatDate(m.createdAt, true)}
                    {m.sentAt && (
                      <div className={styles.muted}>
                        Sent {formatDate(m.sentAt, true)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      {result && result.total > 0 && (
        <nav className={styles.pager} aria-label="Pagination">
          <span>
            Page {result.page} of {result.totalPages} ·{' '}
            {result.total.toLocaleString()} emails
          </span>
          <div className={styles.pagerButtons}>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page <= 1}
              onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
            >
              <Icon name="chevronLeft" size={16} /> Previous
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={result.page >= result.totalPages}
              onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
            >
              Next <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </nav>
      )}
    </>
  );
}

function TemplatePreviews() {
  const [templates, setTemplates] = useState<MailTemplateInfo[] | null>(null);
  const [selected, setSelected] = useState('verify_email');
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    mailApi
      .templates()
      .then((t) => !cancelled && setTemplates(t))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    mailApi
      .preview(selected)
      .then((h) => !cancelled && setHtml(h))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (error) return <p role="alert">{error}</p>;
  if (!templates) return <p aria-busy="true">Loading templates…</p>;
  const current = templates.find((t) => t.name === selected);

  return (
    <div className={styles.templatesLayout}>
      <ul className={styles.templateList} aria-label="Templates">
        {templates.map((t) => (
          <li key={t.name}>
            <button
              type="button"
              className={
                t.name === selected
                  ? styles.templateActive
                  : styles.templateItem
              }
              aria-pressed={t.name === selected}
              onClick={() => setSelected(t.name)}
            >
              <strong>{TEMPLATE_LABELS[t.name] ?? t.name}</strong>
              <span className={styles.muted}>{t.subject}</span>
              {t.placeholder && (
                <span className={styles.badge} style={{ width: 'fit-content' }}>
                  Placeholder · not sent yet
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <section className={styles.card} aria-label="Preview">
        <h2>{current ? `Subject: ${current.subject}` : 'Preview'}</h2>
        <p className={styles.muted} style={{ margin: 0 }}>
          Rendered with sample data.
        </p>
        {/* Sandboxed: no scripts, no same-origin access. */}
        <iframe
          title="Email preview"
          className={styles.previewFrame}
          sandbox=""
          srcDoc={html}
        />
      </section>
    </div>
  );
}
