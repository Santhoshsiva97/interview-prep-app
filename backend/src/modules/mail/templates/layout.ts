/** Escapes text for safe interpolation into HTML. */
export const escapeHtml = (value: string | number): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface MailContext {
  /** Public web-app URL, e.g. https://app.example.com (no trailing slash). */
  appUrl: string;
  productName: string;
}

export interface LayoutParts {
  /** Hidden inbox-preview line. */
  preheader: string;
  heading: string;
  /** Trusted HTML (callers must escape interpolated values). */
  bodyHtml: string;
  /** Optional call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the card, e.g. "didn't request this?" (trusted HTML). */
  footnoteHtml?: string;
}

const BRAND = '#2f5bd3';

/**
 * Shared email layout: table-based with inline styles so it renders in
 * Gmail/Outlook/Apple Mail. Keep it simple — no web fonts, no external images.
 */
export function renderLayout(ctx: MailContext, parts: LayoutParts): string {
  const cta = parts.cta
    ? `<tr><td style="padding:8px 0 4px">
        <a href="${escapeHtml(parts.cta.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${escapeHtml(parts.cta.label)}</a>
      </td></tr>`
    : '';
  const footnote = parts.footnoteHtml
    ? `<p style="margin:16px 0 0;color:#6b7280;font-size:13px;line-height:1.5">${parts.footnoteHtml}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(parts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">${escapeHtml(parts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
      <tr><td style="padding:0 4px 16px;font-size:18px;font-weight:700;color:${BRAND}">${escapeHtml(ctx.productName)}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 28px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(parts.heading)}</h1></td></tr>
          <tr><td style="font-size:15px;line-height:1.6">${parts.bodyHtml}</td></tr>
          ${cta}
        </table>
        ${footnote}
      </td></tr>
      <tr><td style="padding:16px 4px 0;color:#9ca3af;font-size:12px;line-height:1.5">
        You’re receiving this email because of your ${escapeHtml(ctx.productName)} account.<br>
        <a href="${escapeHtml(ctx.appUrl)}" style="color:#9ca3af">${escapeHtml(ctx.appUrl.replace(/^https?:\/\//, ''))}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Large, copy-friendly one-time code block. */
export const codeBlock = (code: string) =>
  `<p style="margin:20px 0;text-align:center"><span style="display:inline-block;font-family:'SFMono-Regular',Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:8px;padding:14px 22px;background:#f3f4f6;border-radius:8px;color:#111827">${escapeHtml(code)}</span></p>`;

export const greeting = (name?: string) =>
  `<p style="margin:0 0 12px">Hi${name ? ` ${escapeHtml(name.split(' ')[0])}` : ''},</p>`;
