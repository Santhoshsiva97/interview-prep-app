import { parse as parseCsv } from 'csv-parse/sync';

/**
 * Bulk-upload file formats (FRD §4.11). This is the contract the Content
 * Acquisition Tool targets. Documented in docs/question-import-format.md;
 * keep the two in sync.
 */

/** One question as it appears in an import file (names/slugs, not ids). */
export interface ImportQuestion {
  /** Stable id from the source system. Re-importing the same id updates that question. */
  externalId?: string;
  type: string;
  title: string;
  body: string;
  /** Topic slug or name. */
  topic: string;
  difficulty: string;
  /** Tag slugs or names. Prefix with "company:" for company tags, e.g. "company:Google". */
  tags?: string[];
  explanation?: string;
  marks?: number;
  mcq?: {
    allowMultiple?: boolean;
    options: { text: string; isCorrect: boolean }[];
  };
  coding?: {
    timeLimitMs?: number;
    memoryLimitMb?: number;
    starterCode?: Record<string, string>;
    testCases: {
      input: string;
      expectedOutput: string;
      isSample?: boolean;
      weight?: number;
    }[];
  };
}

export interface ParsedRow {
  /** 1-based data row (CSV: line number incl. header; JSON: array position). */
  row: number;
  question?: ImportQuestion;
  /** Problems found while reading the row (before validation). */
  errors: { field: string; message: string }[];
}

export const MAX_IMPORT_ROWS = 1000;

export class ImportFileError extends Error {}

export const CSV_COLUMNS = [
  'external_id',
  'type',
  'title',
  'body',
  'topic',
  'difficulty',
  'tags',
  'explanation',
  'marks',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
  'option_5',
  'option_6',
  'option_7',
  'option_8',
  'correct',
  'allow_multiple',
  'time_limit_ms',
  'memory_limit_mb',
  'starter_code',
  'test_cases',
] as const;

export function parseImportFile(
  buffer: Buffer,
  fileName: string,
): { format: 'csv' | 'json'; rows: ParsedRow[] } {
  const raw = buffer.toString('utf8');
  // Strip the byte-order mark Excel adds to UTF-8 CSVs.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const format =
    /\.json$/i.test(fileName) || /^\s*[[{]/.test(text) ? 'json' : 'csv';
  const rows = format === 'json' ? parseJson(text) : parseCsvText(text);
  if (rows.length === 0)
    throw new ImportFileError('The file has no questions.');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new ImportFileError(
      `Too many rows (${rows.length}). The limit is ${MAX_IMPORT_ROWS} per file.`,
    );
  }
  return { format, rows };
}

function parseJson(text: string): ParsedRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ImportFileError(`Invalid JSON: ${(err as Error).message}`);
  }
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === 'object' &&
        Array.isArray((data as { questions?: unknown }).questions)
      ? (data as { questions: unknown[] }).questions
      : null;
  if (!list)
    throw new ImportFileError(
      'JSON must be an array of questions or { "questions": [...] }.',
    );
  return list.map((item, i) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { row: i + 1, question: item as ImportQuestion, errors: [] }
      : {
          row: i + 1,
          errors: [
            { field: 'row', message: 'Each question must be a JSON object' },
          ],
        },
  );
}

const truthy = (v: string) => /^(true|yes|y|1)$/i.test(v.trim());

function parseCsvText(text: string): ParsedRow[] {
  let records: Record<string, string>[];
  try {
    records = parseCsv(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: false,
      relax_column_count: true,
    });
  } catch (err) {
    throw new ImportFileError(`Invalid CSV: ${(err as Error).message}`);
  }
  if (records.length && !('type' in records[0] && 'title' in records[0])) {
    throw new ImportFileError(
      `CSV header must include at least: type, title, body, topic, difficulty.`,
    );
  }
  return records.map((r, i) => csvRow(r, i + 2));
}

function csvRow(r: Record<string, string>, row: number): ParsedRow {
  const errors: ParsedRow['errors'] = [];
  const get = (k: string) => (r[k] ?? '').trim();
  const json = <T>(field: string): T | undefined => {
    const v = get(field);
    if (!v) return undefined;
    try {
      return JSON.parse(v) as T;
    } catch {
      errors.push({ field, message: 'must be valid JSON' });
      return undefined;
    }
  };
  const num = (field: string) => {
    const v = get(field);
    if (!v) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n))
      errors.push({ field, message: 'must be a whole number' });
    return n;
  };

  const type = get('type').toLowerCase();
  const q: ImportQuestion = {
    externalId: get('external_id') || undefined,
    type,
    title: get('title'),
    body: r.body ?? '',
    topic: get('topic'),
    difficulty: get('difficulty').toLowerCase(),
    tags: get('tags')
      ? get('tags')
          .split('|')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    explanation: get('explanation') || undefined,
    marks: num('marks'),
  };

  if (type === 'mcq') {
    const texts = Array.from({ length: 8 }, (_, i) => get(`option_${i + 1}`));
    const correct = new Set(
      get('correct')
        .split(/[,|\s]+/)
        .filter(Boolean)
        .map(Number),
    );
    if (correct.size === 0)
      errors.push({
        field: 'correct',
        message: 'list the correct option number(s), e.g. "2" or "1,3"',
      });
    for (const n of correct) {
      if (!Number.isInteger(n) || n < 1 || n > 8 || !texts[n - 1]) {
        errors.push({
          field: 'correct',
          message: `option ${String(n)} doesn’t exist`,
        });
      }
    }
    q.mcq = {
      allowMultiple: truthy(get('allow_multiple')) || correct.size > 1,
      options: texts
        .map((text, i) => ({ text, isCorrect: correct.has(i + 1) }))
        .filter((o) => o.text),
    };
  } else if (type === 'coding') {
    q.coding = {
      timeLimitMs: num('time_limit_ms'),
      memoryLimitMb: num('memory_limit_mb'),
      starterCode: json<Record<string, string>>('starter_code'),
      testCases:
        json<NonNullable<ImportQuestion['coding']>['testCases']>(
          'test_cases',
        ) ?? [],
    };
  }
  return { row, question: q, errors };
}

/** Sample files served by GET /admin/question-imports/template. */
export const TEMPLATE_JSON = {
  questions: [
    {
      externalId: 'cat-arrays-0001',
      type: 'mcq',
      title: 'Time complexity of binary search',
      body: 'What is the worst-case time complexity of binary search on a sorted array of *n* elements?',
      topic: 'arrays-and-hashing',
      difficulty: 'easy',
      tags: ['binary-search', 'company:Amazon'],
      explanation:
        'Each step halves the search range, so at most log₂(n) + 1 comparisons are needed.',
      marks: 1,
      mcq: {
        allowMultiple: false,
        options: [
          { text: 'O(1)', isCorrect: false },
          { text: 'O(log n)', isCorrect: true },
          { text: 'O(n)', isCorrect: false },
          { text: 'O(n log n)', isCorrect: false },
        ],
      },
    },
    {
      externalId: 'cat-strings-0001',
      type: 'coding',
      title: 'Reverse words in a sentence',
      body: 'Given a line of text, print the words in reverse order separated by single spaces.',
      topic: 'strings',
      difficulty: 'easy',
      tags: ['two-pointers'],
      marks: 10,
      coding: {
        timeLimitMs: 2000,
        memoryLimitMb: 256,
        starterCode: { python: 'line = input()\n# your code here\n' },
        testCases: [
          {
            input: 'hello world',
            expectedOutput: 'world hello',
            isSample: true,
          },
          {
            input: 'a b c',
            expectedOutput: 'c b a',
            isSample: false,
            weight: 2,
          },
        ],
      },
    },
  ],
};

export const TEMPLATE_CSV =
  [
    CSV_COLUMNS.join(','),
    [
      'cat-arrays-0001',
      'mcq',
      'Time complexity of binary search',
      '"What is the worst-case time complexity of binary search on a sorted array of *n* elements?"',
      'arrays-and-hashing',
      'easy',
      'binary-search|company:Amazon',
      '"Each step halves the search range."',
      '1',
      'O(1)',
      'O(log n)',
      'O(n)',
      'O(n log n)',
      '',
      '',
      '',
      '',
      '2',
      'false',
      '',
      '',
      '',
      '',
    ].join(','),
    [
      'cat-strings-0001',
      'coding',
      'Reverse words in a sentence',
      '"Given a line of text, print the words in reverse order."',
      'strings',
      'easy',
      'two-pointers',
      '',
      '10',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '2000',
      '256',
      '"{""python"": ""line = input()\\n""}"',
      '"[{""input"": ""hello world"", ""expectedOutput"": ""world hello"", ""isSample"": true}, {""input"": ""a b c"", ""expectedOutput"": ""c b a"", ""isSample"": false}]"',
    ].join(','),
  ].join('\r\n') + '\r\n';
