import {
  CSV_COLUMNS,
  ImportFileError,
  parseImportFile,
  TEMPLATE_CSV,
  TEMPLATE_JSON,
} from './import-format.js';

const csv = (...rows: string[]) =>
  Buffer.from([CSV_COLUMNS.join(','), ...rows].join('\n'));
const blank = (n: number) => Array(n).fill('').join(',');

describe('parseImportFile', () => {
  it('reads an MCQ CSV row (options, correct numbers, pipe-separated tags)', () => {
    const row = [
      'ext-1',
      'MCQ',
      'Title',
      '"Body, with comma"',
      'arrays',
      'Easy',
      'hashing|company:Google',
      '',
      '2',
      'A',
      'B',
      'C',
      '',
      '',
      '',
      '',
      '',
      '2',
      '',
      blank(4),
    ].join(',');
    const { format, rows } = parseImportFile(csv(row), 'q.csv');
    expect(format).toBe('csv');
    expect(rows[0]).toMatchObject({
      row: 2,
      errors: [],
      question: {
        externalId: 'ext-1',
        type: 'mcq',
        difficulty: 'easy',
        body: 'Body, with comma',
        tags: ['hashing', 'company:Google'],
        marks: 2,
        mcq: {
          allowMultiple: false,
          options: [
            { text: 'A', isCorrect: false },
            { text: 'B', isCorrect: true },
            { text: 'C', isCorrect: false },
          ],
        },
      },
    });
  });

  it('infers multiple answers and flags bad option numbers', () => {
    const multi = [
      '',
      'mcq',
      'T',
      'B',
      't',
      'easy',
      '',
      '',
      '',
      'A',
      'B',
      'C',
      '',
      '',
      '',
      '',
      '',
      '"1,3"', // quoted: contains a comma
      '',
      blank(4),
    ];
    expect(
      parseImportFile(csv(multi.join(',')), 'q.csv').rows[0].question?.mcq
        ?.allowMultiple,
    ).toBe(true);

    multi[17] = '5';
    expect(
      parseImportFile(csv(multi.join(',')), 'q.csv').rows[0].errors[0],
    ).toEqual({
      field: 'correct',
      message: 'option 5 doesn’t exist',
    });
  });

  it('reads coding test cases and starter code from JSON cells', () => {
    const { rows } = parseImportFile(Buffer.from(TEMPLATE_CSV), 'template.csv');
    expect(rows).toHaveLength(2);
    expect(rows[1].errors).toEqual([]);
    expect(rows[1].question?.coding).toMatchObject({
      timeLimitMs: 2000,
      starterCode: { python: 'line = input()\n' },
      testCases: [
        { input: 'hello world', isSample: true },
        { input: 'a b c', isSample: false },
      ],
    });
  });

  it('reports invalid JSON cells per row instead of failing the file', () => {
    const row = [
      '',
      'coding',
      'T',
      'B',
      't',
      'easy',
      blank(12),
      '',
      '',
      '',
      '{not json',
      '[]',
    ].join(',');
    expect(parseImportFile(csv(row), 'q.csv').rows[0].errors).toEqual([
      { field: 'starter_code', message: 'must be valid JSON' },
    ]);
  });

  it('accepts JSON as an array or { questions } and strips a BOM', () => {
    const wrapped = Buffer.from(
      String.fromCharCode(0xfeff) + JSON.stringify(TEMPLATE_JSON),
    );
    expect(parseImportFile(wrapped, 'q.json').rows).toHaveLength(2);
    const bare = Buffer.from(JSON.stringify(TEMPLATE_JSON.questions));
    expect(parseImportFile(bare, 'q.txt').format).toBe('json');
    expect(
      parseImportFile(Buffer.from('[1]'), 'q.json').rows[0].errors[0].field,
    ).toBe('row');
  });

  it('rejects unusable files with a clear message', () => {
    expect(() => parseImportFile(Buffer.from('{oops'), 'q.json')).toThrow(
      ImportFileError,
    );
    expect(() => parseImportFile(Buffer.from('{"x":1}'), 'q.json')).toThrow(
      /array of questions/,
    );
    expect(() => parseImportFile(Buffer.from('a,b\n1,2'), 'q.csv')).toThrow(
      /header/,
    );
    expect(() => parseImportFile(Buffer.from('[]'), 'q.json')).toThrow(
      /no questions/,
    );
    const many = Buffer.from(JSON.stringify(Array(1001).fill({})));
    expect(() => parseImportFile(many, 'q.json')).toThrow(/limit is 1000/);
  });
});
