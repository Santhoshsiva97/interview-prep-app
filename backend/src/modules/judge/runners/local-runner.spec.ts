import { UnavailableCodeRunner } from './code-runner.js';
import { LocalProcessCodeRunner } from './local-runner.js';

const SUM = `const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);
console.log(a + b);`;
const js = (source: string, inputs = ['2 3\n', '10 -4\n']) => ({
  language: 'javascript' as const,
  source,
  inputs,
  timeLimitMs: 1000,
  memoryLimitMb: 128,
});

describe('UnavailableCodeRunner', () => {
  it('says running code is unavailable', async () => {
    const r = await new UnavailableCodeRunner().run();
    expect(r).toMatchObject({ status: 'unavailable', outcomes: [] });
  });
});

describe('LocalProcessCodeRunner (JavaScript via Node)', () => {
  const runner = new LocalProcessCodeRunner();

  it('feeds stdin per test case and returns stdout', async () => {
    const r = await runner.run(js(SUM));
    expect(r.status).toBe('completed');
    expect(r.outcomes.map((o) => [o.status, o.stdout.trim()])).toEqual([
      ['ok', '5'],
      ['ok', '6'],
    ]);
  });

  it('reports runtime errors and time limits', async () => {
    const crash = await runner.run(js('throw new Error("boom")', ['']));
    expect(crash.outcomes[0].status).toBe('runtime_error');
    expect(crash.outcomes[0].stderr).toContain('boom');

    const slow = await runner.run(js('while (true) {}', ['']));
    expect(slow.outcomes[0].status).toBe('time_limit');
  }, 15_000);

  it('does not pass the API server’s environment to candidate code', async () => {
    process.env.JWT_ACCESS_SECRET_PROBE = 'must-not-leak';
    const r = await runner.run(
      js('console.log(process.env.JWT_ACCESS_SECRET_PROBE ?? "none")', ['']),
    );
    delete process.env.JWT_ACCESS_SECRET_PROBE;
    expect(r.outcomes[0].stdout.trim()).toBe('none');
  });

  it('is unavailable for languages without a local toolchain', async () => {
    const r = await runner.run({ ...js(''), language: 'cpp' });
    expect(r.status).toBe('unavailable');
    expect(r.message).toMatch(/code judge/);
  });
});
