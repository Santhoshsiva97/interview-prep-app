import {
  LocalProcessCodeRunner,
  UnavailableCodeRunner,
} from './code-runner.js';

const tests = [
  { input: '2 3\n', expectedOutput: '5' },
  { input: '10 -4\n', expectedOutput: '6' },
];
const js = (source: string) => ({
  language: 'javascript' as const,
  source,
  tests,
  timeLimitMs: 1000,
  memoryLimitMb: 128,
});
const SUM = `const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);
console.log(a + b);`;

describe('UnavailableCodeRunner', () => {
  it('says running code is unavailable', async () => {
    const r = await new UnavailableCodeRunner().run();
    expect(r).toMatchObject({ status: 'unavailable', results: [] });
  });
});

describe('LocalProcessCodeRunner (JavaScript via Node)', () => {
  const runner = new LocalProcessCodeRunner();

  it('feeds stdin and compares stdout per test case', async () => {
    const r = await runner.run(js(SUM));
    expect(r.status).toBe('completed');
    expect(r.results.map((x) => x.verdict)).toEqual(['passed', 'passed']);
    expect(r.results[0].stdout.trim()).toBe('5');
  });

  it('reports wrong output, runtime errors and time limits', async () => {
    const wrong = await runner.run(js('console.log(5)'));
    expect(wrong.results.map((x) => x.verdict)).toEqual(['passed', 'failed']);

    const crash = await runner.run(js('throw new Error("boom")'));
    expect(crash.results[0].verdict).toBe('runtime_error');
    expect(crash.results[0].stderr).toContain('boom');

    const slow = await runner.run({
      ...js('while (true) {}'),
      tests: [tests[0]],
    });
    expect(slow.results[0].verdict).toBe('time_limit');
  }, 15_000);

  it('does not pass the API server’s environment to candidate code', async () => {
    process.env.JWT_ACCESS_SECRET_PROBE = 'must-not-leak';
    const r = await runner.run({
      ...js('console.log(process.env.JWT_ACCESS_SECRET_PROBE ?? "none")'),
      tests: [{ input: '', expectedOutput: 'none' }],
    });
    delete process.env.JWT_ACCESS_SECRET_PROBE;
    expect(r.results[0].verdict).toBe('passed');
  });

  it('marks languages without a local toolchain as unsupported', async () => {
    const r = await runner.run({ ...js(''), language: 'cpp' });
    expect(r.results.every((x) => x.verdict === 'unsupported')).toBe(true);
    expect(r.message).toMatch(/code judge/);
  });
});
