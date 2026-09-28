import { BOM, toCsv } from './csv.js';

describe('toCsv', () => {
  const cols = [
    {
      header: 'name',
      value: (r: { name: string; n: number | null }) => r.name,
    },
    { header: 'n', value: (r: { name: string; n: number | null }) => r.n },
  ];

  it('writes a BOM, a header and CRLF rows, quoting where needed', () => {
    const csv = toCsv(
      [
        { name: 'plain', n: 1 },
        { name: 'a, "quoted"\nvalue', n: null },
      ],
      cols,
    );
    expect(csv).toBe(BOM + 'name,n\r\nplain,1\r\n"a, ""quoted""\nvalue",\r\n');
  });

  it('neutralises spreadsheet formulas in text but keeps negative numbers', () => {
    const csv = toCsv(
      [
        { name: '=HYPERLINK("http://x")', n: -5 },
        { name: '+1', n: 0 },
        { name: '@SUM(A1)', n: 2 },
      ],
      cols,
    );
    const rows = csv.trim().split('\r\n').slice(1);
    expect(rows).toEqual([
      `"'=HYPERLINK(""http://x"")",-5`,
      "'+1,0",
      "'@SUM(A1),2",
    ]);
  });
});
