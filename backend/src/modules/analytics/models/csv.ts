import type { Response } from 'express';

/** UTF-8 byte-order mark, written as a code point so it stays visible in source. */
export const BOM = String.fromCharCode(0xfeff);

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | Date | null | undefined;
}

/**
 * RFC 4180 CSV (CRLF, quoted when needed) with a UTF-8 BOM so Excel reads
 * accents correctly. Text cells that start with = + - @ (or tab/CR) are
 * prefixed with ' so spreadsheet apps don't run them as formulas (CSV
 * injection); real numbers are written as numbers.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((c) => cell(c.header)).join(','),
    ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(',')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function cell(v: string | number | boolean | Date | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = v instanceof Date ? v.toISOString() : v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Sends CSV as a download (use with `@Res({ passthrough: true })`). */
export function sendCsv(res: Response, fileName: string, csv: string): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
  );
  return csv;
}
