import { Judge0CodeRunner } from './judge0-runner.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

interface FakeSub {
  token: string;
  stdin: string;
  body: Record<string, unknown>;
  polls: number;
}

/**
 * In-memory Judge0 speaking the real HTTP API shape. What each submission
 * does is decided by its stdin: "ok:<out>", "tle", "ce", "segv", "oom", "boom".
 */
function fakeJudge0() {
  const subs = new Map<string, FakeSub>();
  const requests: {
    method: string;
    url: string;
    headers: Record<string, string>;
  }[] = [];
  let n = 0;

  const final = (s: FakeSub) => {
    const [kind, out = ''] = s.stdin.split(':');
    const base = {
      token: s.token,
      stdout: null as string | null,
      stderr: null as string | null,
      compile_output: null as string | null,
      message: null as string | null,
      time: '0.012',
      memory: 3000,
    };
    switch (kind) {
      case 'ok':
        return {
          ...base,
          status: { id: 3, description: 'Accepted' },
          stdout: b64(`${out}\n`),
        };
      case 'tle':
        return {
          ...base,
          status: { id: 5, description: 'Time Limit Exceeded' },
        };
      case 'ce':
        return {
          ...base,
          status: { id: 6, description: 'Compilation Error' },
          compile_output: b64('main.cpp:1: error: expected ;'),
          time: null,
          memory: null,
        };
      case 'segv':
        return {
          ...base,
          status: { id: 11, description: 'Runtime Error (NZEC)' },
          stderr: b64('Traceback: ZeroDivisionError'),
        };
      case 'oom':
        return {
          ...base,
          status: { id: 7, description: 'Runtime Error (SIGSEGV)' },
          memory: (s.body.memory_limit as number) - 10,
        };
      default:
        return { ...base, status: { id: 13, description: 'Internal Error' } };
    }
  };

  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    requests.push({
      method: init?.method ?? 'GET',
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (init?.method === 'POST') {
      const { submissions } = JSON.parse(init.body as string) as {
        submissions: Record<string, unknown>[];
      };
      if (submissions.length > 20) return json({ error: 'batch too big' }, 422);
      return json(
        submissions.map((body) => {
          const token = `t${++n}`;
          subs.set(token, {
            token,
            stdin: unb64(body.stdin as string),
            body,
            polls: 0,
          });
          return { token };
        }),
        201,
      );
    }
    const tokens = new URL(url).searchParams.get('tokens')!.split(',');
    return json({
      submissions: tokens.map((t) => {
        const s = subs.get(t)!;
        // First poll: still processing.
        return s.polls++ === 0
          ? { token: t, status: { id: 2, description: 'Processing' } }
          : final(s);
      }),
    });
  };
  return { fetchImpl: fetchImpl, subs, requests };
}

const runner = (fake: ReturnType<typeof fakeJudge0>, timeoutMs = 5000) =>
  new Judge0CodeRunner(
    {
      url: 'http://judge0:2358/',
      authHeader: 'X-Auth-Token',
      authToken: 'secret',
      timeoutMs,
      pollIntervalMs: 1,
    },
    fake.fetchImpl,
    () => Promise.resolve(),
  );

const request = (inputs: string[], language: 'python' | 'cpp' = 'python') => ({
  language,
  source: 'print(input())',
  inputs,
  timeLimitMs: 3000,
  memoryLimitMb: 256,
});

describe('Judge0CodeRunner', () => {
  it('submits base64 batches with limits and auth, polls until done, keeps input order', async () => {
    const fake = fakeJudge0();
    const r = await runner(fake).run(request(['ok:1', 'ok:2', 'tle']));

    expect(r.status).toBe('completed');
    expect(r.outcomes.map((o) => o.status)).toEqual(['ok', 'ok', 'time_limit']);
    expect(r.outcomes[1]).toMatchObject({
      stdout: '2\n',
      timeMs: 12,
      memoryKb: 3000,
    });

    const body = [...fake.subs.values()][0].body;
    expect(body).toMatchObject({
      language_id: 71,
      source_code: b64('print(input())'),
      cpu_time_limit: 3,
      wall_time_limit: 7,
      memory_limit: 256 * 1024,
      enable_network: false,
    });
    expect(fake.requests[0].url).toBe(
      'http://judge0:2358/submissions/batch?base64_encoded=true',
    );
    expect(fake.requests[0].headers['X-Auth-Token']).toBe('secret');
    // One POST, then polls (first says "processing").
    expect(fake.requests.filter((q) => q.method === 'GET').length).toBe(2);
  });

  it('maps compile errors, runtime errors, memory exhaustion and internal errors', async () => {
    const fake = fakeJudge0();
    const r = await runner(fake).run(
      request(['ce', 'segv', 'oom', 'weird'], 'cpp'),
    );
    expect(r.outcomes.map((o) => o.status)).toEqual([
      'compile_error',
      'runtime_error',
      'memory_limit',
      'internal_error',
    ]);
    expect(r.compileOutput).toContain('expected ;');
    expect(r.outcomes[1].stderr).toContain('ZeroDivisionError');
    expect([...fake.subs.values()][0].body.language_id).toBe(54);
  });

  it('splits more than 20 tests into several batches', async () => {
    const fake = fakeJudge0();
    const inputs = Array.from({ length: 45 }, (_, i) => `ok:${i}`);
    const r = await runner(fake).run(request(inputs));
    expect(r.outcomes).toHaveLength(45);
    expect(r.outcomes[44].stdout).toBe('44\n');
    expect(fake.requests.filter((q) => q.method === 'POST')).toHaveLength(3);
  });

  it('throws (so the job is retried) when Judge0 errors or never finishes', async () => {
    const down = new Judge0CodeRunner(
      { url: 'http://judge0', authHeader: 'X-Auth-Token', timeoutMs: 1000 },
      () => Promise.resolve(new Response('busy', { status: 503 })),
    );
    await expect(down.run(request(['ok:1']))).rejects.toThrow(/503/);

    const fake = fakeJudge0();
    const stuck = new Judge0CodeRunner(
      {
        url: 'http://judge0',
        authHeader: 'X-Auth-Token',
        timeoutMs: -1,
        pollIntervalMs: 1,
      },
      fake.fetchImpl,
      () => Promise.resolve(),
    );
    await expect(stuck.run(request(['ok:1']))).rejects.toThrow(
      /did not finish/,
    );
  });
});
