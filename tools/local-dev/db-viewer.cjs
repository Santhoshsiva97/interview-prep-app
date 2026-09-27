// Read-only browser for the local dev database (Prisma dev Postgres on :51214).
// Serves http://localhost:8088. Secrets (password/token hashes) are masked.
// Queries run one at a time: the local dev server can't handle concurrent queries.
const http = require('node:http');
const path = require('node:path');
const { Client } = require(path.join(__dirname, '../../backend/node_modules/pg'));

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:51214/template1?sslmode=disable';
const MASK = new Set(['password_hash', 'token_hash']);
const PAGE = 50;

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cell(col, v) {
  if (v === null || v === undefined) return '<span class="null">NULL</span>';
  if (MASK.has(col)) return `<span class="mask">${esc(String(v).slice(0, 10))}… (hidden)</span>`;
  if (v instanceof Date) return esc(v.toISOString().replace('T', ' ').slice(0, 19));
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `<span title="${esc(s)}">${esc(s.slice(0, 80))}…</span>` : esc(s);
}

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

async function render(table, page) {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  try {
    const tables = (
      await c.query(
        `select t.table_name, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', t.table_name), false, true, '')))[1]::text::int as n
         from information_schema.tables t where table_schema='public' and table_type='BASE TABLE' order by 1`,
      )
    ).rows;
    const current = tables.find((t) => t.table_name === table) ?? tables.find((t) => t.table_name === 'users') ?? tables[0];
    const cols = (
      await c.query(
        `select column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`,
        [current.table_name],
      )
    ).rows;
    const order = cols.some((x) => x.column_name === 'created_at') ? 'created_at desc' : '1';
    const rows = (
      await c.query(`select * from "${current.table_name}" order by ${order} limit ${PAGE} offset ${(page - 1) * PAGE}`)
    ).rows;
    const pages = Math.max(1, Math.ceil(current.n / PAGE));

    const nav = tables
      .map(
        (t) =>
          `<a href="/?table=${t.table_name}" class="${t.table_name === current.table_name ? 'on' : ''}">${esc(t.table_name)} <b>${t.n}</b></a>`,
      )
      .join('');
    const head = cols
      .map((x) => `<th>${esc(x.column_name)}<small>${esc(x.data_type === 'USER-DEFINED' ? x.udt_name : x.data_type)}</small></th>`)
      .join('');
    const body = rows.length
      ? rows.map((r) => `<tr>${cols.map((x) => `<td>${cell(x.column_name, r[x.column_name])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="empty">No rows</td></tr>`;
    const pager =
      pages > 1
        ? `<div class="pager">${page > 1 ? `<a href="/?table=${current.table_name}&page=${page - 1}">← Prev</a>` : ''} Page ${page} of ${pages} ${page < pages ? `<a href="/?table=${current.table_name}&page=${page + 1}">Next →</a>` : ''}</div>`
        : '';

    return `<!doctype html><html><head><meta charset="utf-8"><title>DB · ${esc(current.table_name)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#f7f8fa;--sf:#fff;--bd:#e3e6eb;--tx:#1b1f27;--mu:#5b6475;--pr:#2f5bd3}
@media (prefers-color-scheme:dark){:root{--bg:#11141a;--sf:#181c24;--bd:#2a303b;--tx:#e8ebf0;--mu:#9aa3b2;--pr:#7d9cf0}}
*{box-sizing:border-box}body{margin:0;font:14px system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--tx)}
header{padding:14px 16px;border-bottom:1px solid var(--bd);background:var(--sf)}h1{margin:0;font-size:16px}
header p{margin:4px 0 0;color:var(--mu);font-size:12px}
nav{display:flex;flex-wrap:wrap;gap:6px;padding:12px 16px}
nav a{padding:6px 10px;border:1px solid var(--bd);border-radius:999px;color:var(--tx);text-decoration:none;background:var(--sf)}
nav a.on{border-color:var(--pr);color:var(--pr)}nav b{color:var(--mu);font-weight:600;margin-left:4px}
.wrap{overflow:auto;margin:0 16px 16px;border:1px solid var(--bd);border-radius:8px;background:var(--sf)}
table{border-collapse:collapse;width:max-content;min-width:100%}
th,td{padding:7px 10px;border-bottom:1px solid var(--bd);text-align:left;white-space:nowrap;vertical-align:top}
th{position:sticky;top:0;background:var(--sf);font-size:12px}th small{display:block;color:var(--mu);font-weight:400}
.null{color:var(--mu);font-style:italic}.mask{color:var(--mu)}.empty{color:var(--mu);text-align:center;padding:24px}
.pager{padding:0 16px 16px;color:var(--mu)}.pager a{color:var(--pr)}
</style></head><body>
<header><h1>Local database · read-only</h1><p>localhost:51214 · newest first · ${PAGE} rows per page · password/token hashes hidden</p></header>
<nav>${nav}</nav><div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${pager}
</body></html>`;
  } finally {
    await c.end();
  }
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/') return res.writeHead(404).end();
    serial(() =>
      render(u.searchParams.get('table'), Math.max(1, Number(u.searchParams.get('page')) || 1)).then(
        (html) => res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html),
        (err) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err)),
      ),
    );
  })
  .listen(8088, '127.0.0.1', () => console.log('DB viewer on http://localhost:8088'));
