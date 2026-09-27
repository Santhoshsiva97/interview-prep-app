import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FormAlert } from '../../../components/form/FormField';
import { Icon } from '../../../components/icons/Icon';
import btn from '../../../components/ui/Button.module.css';
import { formatDate } from '../../../features/admin/api';
import {
  downloadText,
  questionsApi,
  type ImportRecord,
  type ImportReport,
  type ImportRow,
} from '../../../features/questions/api';
import { errorMessage } from '../../../lib/api';
import styles from '../Admin.module.css';
import q from './Questions.module.css';

const MAX_BYTES = 5 * 1024 * 1024;

const ACTION: Record<ImportRow['action'], { label: string; tone?: string }> = {
  create: { label: 'New', tone: 'success' },
  update: { label: 'Updated', tone: 'primary' },
  unchanged: { label: 'Unchanged' },
  error: { label: 'Error', tone: 'danger' },
};

/** CSV of the failed rows, for fixing in a spreadsheet. */
function errorReportCsv(report: ImportReport) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = ['row,external_id,title,field,message'];
  for (const r of report.rows.filter((x) => x.errors.length)) {
    for (const e of r.errors) {
      lines.push(
        [
          String(r.row),
          esc(r.externalId ?? ''),
          esc(r.title ?? ''),
          esc(e.field),
          esc(e.message),
        ].join(','),
      );
    }
  }
  return lines.join('\r\n');
}

/** Bulk question upload with dry-run validation (FRD §4.11). */
export function QuestionImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [submitForReview, setSubmitForReview] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<'validate' | 'import' | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    questionsApi.importHistory().then(setHistory, () => undefined);
  }, [historyKey]);

  function choose(f: File | undefined) {
    setReport(null);
    setError('');
    if (!f) return;
    if (!/\.(csv|json)$/i.test(f.name))
      return setError('Choose a .csv or .json file.');
    if (f.size > MAX_BYTES) return setError('That file is larger than 5 MB.');
    setFile(f);
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? 'validate' : 'import');
    setError('');
    try {
      const r = await questionsApi.import(file, {
        dryRun,
        submitForReview,
        createMissingTaxonomy: createMissing,
      });
      setReport(r);
      if (!dryRun) setHistoryKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function template(format: 'csv' | 'json') {
    try {
      const text = await questionsApi.template(format);
      downloadText(
        `question-import-template.${format}`,
        text,
        format === 'csv' ? 'text/csv' : 'application/json',
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const importable = report ? report.created + report.updated : 0;

  return (
    <div className={styles.page}>
      <Link to="/admin/questions" className={styles.backLink}>
        <Icon name="arrowLeft" size={16} /> Question bank
      </Link>
      <header>
        <h1 className={styles.title}>Bulk upload</h1>
        <p className={styles.subtitle}>
          Import up to 1,000 questions from CSV or JSON. Rows with an{' '}
          <code>external_id</code> update the same question when re-imported.
          New and changed questions arrive as drafts.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="upload-heading">
        <h2 id="upload-heading">1. Choose a file</h2>
        <div className={q.headerActions}>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => inputRef.current?.click()}
          >
            <Icon name="upload" size={18} />{' '}
            {file ? 'Choose another file' : 'Choose file'}
          </button>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => void template('csv')}
          >
            <Icon name="file" size={18} /> CSV template
          </button>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => void template('json')}
          >
            <Icon name="file" size={18} /> JSON template
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          hidden
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {file && (
          <p className={styles.muted} style={{ margin: 0 }}>
            Selected: <strong>{file.name}</strong> (
            {Math.ceil(file.size / 1024)} KB)
          </p>
        )}
        <label className={q.correctToggle}>
          <input
            type="checkbox"
            checked={createMissing}
            onChange={(e) => {
              setCreateMissing(e.target.checked);
              setReport(null);
            }}
          />
          Create topics and tags that don’t exist yet
        </label>
        <label className={q.correctToggle}>
          <input
            type="checkbox"
            checked={submitForReview}
            onChange={(e) => setSubmitForReview(e.target.checked)}
          />
          Submit imported questions for review
        </label>
        <FormAlert>{error}</FormAlert>
        <h2>2. Validate, then import</h2>
        <div className={q.headerActions}>
          <button
            type="button"
            className={btn.secondary}
            disabled={!file || busy !== null}
            onClick={() => void run(true)}
          >
            {busy === 'validate' ? 'Validating…' : 'Validate (dry run)'}
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={
              !file || busy !== null || !report?.dryRun || importable === 0
            }
            onClick={() => void run(false)}
            title={!report?.dryRun ? 'Validate the file first' : undefined}
          >
            {busy === 'import'
              ? 'Importing…'
              : report?.dryRun
                ? `Import ${importable} valid row${importable === 1 ? '' : 's'}`
                : 'Import'}
          </button>
        </div>
      </section>

      {report && <Report report={report} />}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className={styles.sectionTitle}>
          Recent imports
        </h2>
        {history.length === 0 ? (
          <p className={styles.muted}>No imports yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Rows</th>
                <th scope="col">New / updated / unchanged</th>
                <th scope="col">Errors</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div className={styles.userCell}>
                      <strong>{h.fileName}</strong>
                      <span>{h.uploadedBy?.name ?? 'System (seed)'}</span>
                    </div>
                  </td>
                  <td data-label="Rows">{h.totalRows}</td>
                  <td data-label="New / upd / same">
                    {h.createdCount} / {h.updatedCount} / {h.unchangedCount}
                  </td>
                  <td data-label="Errors">
                    <span
                      className={styles.badge}
                      data-tone={h.errorCount ? 'danger' : 'success'}
                    >
                      {h.errorCount}
                    </span>
                  </td>
                  <td data-label="When">{formatDate(h.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Report({ report }: { report: ImportReport }) {
  const [onlyErrors, setOnlyErrors] = useState(report.failed > 0);
  const rows = onlyErrors
    ? report.rows.filter((r) => r.action === 'error')
    : report.rows;
  const newTax = [
    ...report.newTaxonomy.topics.map((t) => `topic “${t}”`),
    ...report.newTaxonomy.tags.map((t) => `tag “${t}”`),
  ];

  return (
    <section
      className={styles.card}
      aria-labelledby="report-heading"
      aria-live="polite"
    >
      <h2 id="report-heading">
        {report.dryRun ? 'Validation report' : 'Import complete'} ·{' '}
        {report.fileName}
      </h2>
      <div className={styles.kpis}>
        <Stat
          label={report.dryRun ? 'Will create' : 'Created'}
          value={report.created}
          tone="success"
        />
        <Stat
          label={report.dryRun ? 'Will update' : 'Updated'}
          value={report.updated}
          tone="primary"
        />
        {!report.dryRun && <Stat label="Unchanged" value={report.unchanged} />}
        <Stat
          label="Errors"
          value={report.failed}
          tone={report.failed ? 'danger' : undefined}
        />
      </div>
      {newTax.length > 0 && (
        <p className={styles.muted} style={{ margin: 0 }}>
          {report.dryRun ? 'Will create' : 'Created'}: {newTax.join(', ')}.
        </p>
      )}
      {report.dryRun && report.updated > 0 && (
        <p className={styles.muted} style={{ margin: 0 }}>
          “Will update” rows match an existing external id; unchanged content
          won’t create a new version.
        </p>
      )}
      <div className={q.headerActions}>
        <label className={q.correctToggle}>
          <input
            type="checkbox"
            checked={onlyErrors}
            onChange={(e) => setOnlyErrors(e.target.checked)}
          />
          Show only rows with errors
        </label>
        {report.failed > 0 && (
          <button
            type="button"
            className={btn.secondary}
            onClick={() =>
              downloadText(
                `import-errors-${report.fileName.replace(/\.\w+$/, '')}.csv`,
                errorReportCsv(report),
                'text/csv',
              )
            }
          >
            Download error report (CSV)
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>No rows to show.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Question</th>
              <th scope="col">Result</th>
              <th scope="col">Problems</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.row}>
                <td data-label="Row">{r.row}</td>
                <td>
                  <div className={styles.userCell}>
                    {r.questionId && !report.dryRun ? (
                      <Link to={`/admin/questions/${r.questionId}`}>
                        {r.title || '(untitled)'}
                      </Link>
                    ) : (
                      <strong>{r.title || '(untitled)'}</strong>
                    )}
                    {r.externalId && <span>{r.externalId}</span>}
                  </div>
                </td>
                <td data-label="Result">
                  <span
                    className={styles.badge}
                    data-tone={ACTION[r.action].tone}
                  >
                    {ACTION[r.action].label}
                  </span>
                </td>
                <td data-label="Problems">
                  {r.errors.length === 0 ? (
                    '—'
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {r.errors.map((e, i) => (
                        <li
                          key={i}
                          className={styles.errorNote}
                          style={{ maxWidth: 'none' }}
                        >
                          <strong>{e.field}</strong>: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span
        className={styles.kpiValue}
        style={
          tone
            ? { color: `var(--color-${tone === 'primary' ? 'primary' : tone})` }
            : undefined
        }
      >
        {value}
      </span>
    </div>
  );
}
