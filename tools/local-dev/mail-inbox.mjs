// Local mail catcher (Mailpit-style): SMTP on :2525 (any AUTH accepted) and a
// web inbox on http://localhost:8025. Messages are kept in ./mails as .eml.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

const DIR = new URL('./mails/', import.meta.url);
mkdirSync(DIR, { recursive: true });
/** @type {{id:string,from:string,to:string,subject:string,date:Date,html:string,text:string}[]} */
const inbox = [];

async function add(id, raw) {
  const m = await simpleParser(raw);
  inbox.push({
    id,
    from: m.from?.text ?? '',
    to: m.to?.text ?? '',
    subject: m.subject ?? '(no subject)',
    date: m.date ?? new Date(),
    html: m.html || '',
    text: m.text || '',
  });
  inbox.sort((a, b) => b.date - a.date);
}

// Load anything captured earlier (including the old sink's NN.eml files).
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.eml'))) {
  await add(f.replace(/\.eml$/, ''), readFileSync(new URL(f, DIR)));
}

new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth: (auth, _s, cb) => cb(null, { user: auth.username }),
  onData(stream, _session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const id = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(new URL(`${id}.eml`, DIR), raw);
      await add(id, raw);
      console.log(`MAIL ${id} -> ${inbox[0].to} "${inbox[0].subject}"`);
      cb();
    });
  },
}).listen(2525, '127.0.0.1', () => console.log('SMTP on 2525'));

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (d) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function page(selected) {
  const list = inbox.length
    ? inbox
        .map(
          (m) => `<a class="item ${m.id === selected?.id ? 'on' : ''}" href="/?id=${encodeURIComponent(m.id)}">
            <span class="to">${esc(m.to)}</span><span class="when">${esc(when(m.date))}</span>
            <span class="subj">${esc(m.subject)}</span></a>`,
        )
        .join('')
    : '<p class="muted pad">No mail yet. Sign up or use “Forgot password” in the app.</p>';
  const view = selected
    ? `<div class="meta"><h2>${esc(selected.subject)}</h2>
        <p><b>From</b> ${esc(selected.from)}<br><b>To</b> ${esc(selected.to)}<br><b>Date</b> ${esc(when(selected.date))}</p>
        <p class="tabs"><a href="/?id=${encodeURIComponent(selected.id)}">HTML</a> · <a href="/?id=${encodeURIComponent(selected.id)}&view=text">Plain text</a></p></div>
       ${
         selected.view === 'text'
           ? `<pre>${esc(selected.text)}</pre>`
           : `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(selected.html || `<pre>${esc(selected.text)}</pre>`)}"></iframe>`
       }`
    : '<p class="muted pad">Select a message.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local inbox (${inbox.length})</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${selected ? 60 : 10}">
<style>
:root{--bg:#f7f8fa;--sf:#fff;--bd:#e3e6eb;--tx:#1b1f27;--mu:#5b6475;--pr:#2f5bd3}
@media (prefers-color-scheme:dark){:root{--bg:#11141a;--sf:#181c24;--bd:#2a303b;--tx:#e8ebf0;--mu:#9aa3b2;--pr:#7d9cf0}}
*{box-sizing:border-box}body{margin:0;font:14px system-ui,-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--tx)}
header{padding:12px 16px;border-bottom:1px solid var(--bd);background:var(--sf)}h1{margin:0;font-size:16px}
header p{margin:2px 0 0;color:var(--mu);font-size:12px}
main{display:grid;grid-template-columns:minmax(220px,320px) 1fr;min-height:calc(100vh - 58px)}
.list{border-right:1px solid var(--bd);background:var(--sf);overflow:auto}
.item{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:10px 14px;border-bottom:1px solid var(--bd);color:var(--tx);text-decoration:none}
.item.on{background:color-mix(in srgb,var(--pr) 12%,transparent)}.to{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.when{color:var(--mu);font-size:12px}.subj{grid-column:1/-1;color:var(--mu);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.view{display:flex;flex-direction:column;min-width:0}.meta{padding:12px 16px}.meta h2{margin:0 0 6px;font-size:17px}.meta p{margin:4px 0;color:var(--mu)}
.tabs a{color:var(--pr)}iframe{flex:1;min-height:560px;border:0;border-top:1px solid var(--bd);background:#f3f4f6}
pre{margin:0;padding:16px;border-top:1px solid var(--bd);white-space:pre-wrap}.muted{color:var(--mu)}.pad{padding:16px}
@media (max-width:700px){main{grid-template-columns:1fr}.list{max-height:40vh;border-right:0;border-bottom:1px solid var(--bd)}}
</style></head><body>
<header><h1>Local inbox · ${inbox.length} message${inbox.length === 1 ? '' : 's'}</h1><p>SMTP localhost:2525 · nothing leaves this machine · auto-refreshes</p></header>
<main><nav class="list">${list}</nav><section class="view">${view}</section></main></body></html>`;
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const m = inbox.find((x) => x.id === u.searchParams.get('id'));
    if (u.pathname === '/raw') {
      if (!m) return res.writeHead(404).end();
      return res
        .writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:",
        })
        .end(m.html || `<pre>${esc(m.text)}</pre>`);
    }
    if (u.pathname !== '/') return res.writeHead(404).end();
    const selected = m ?? inbox[0];
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(page(selected && { ...selected, view: u.searchParams.get('view') }));
  })
  .listen(8025, '127.0.0.1', () => console.log('Inbox on http://localhost:8025'));
