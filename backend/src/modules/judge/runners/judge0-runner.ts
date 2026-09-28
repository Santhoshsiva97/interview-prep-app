import { Logger } from '@nestjs/common';
import { LANGUAGES, type TestOutcome } from '../models/judging.js';
import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
} from './code-runner.js';

export interface Judge0Config {
  /** e.g. http://judge0-server:2358 */
  url: string;
  /** Header carrying the token (Judge0's AUTHN_HEADER, default X-Auth-Token). */
  authHeader: string;
  authToken?: string;
  /** Give up on a batch after this long (the job is then retried). */
  timeoutMs: number;
  pollIntervalMs?: number;
}

/** Judge0's own limits (defaults of MAX_CPU_TIME_LIMIT / MAX_WALL_TIME_LIMIT / MAX_SUBMISSION_BATCH_SIZE). */
const MAX_CPU_SECONDS = 15;
const MAX_WALL_SECONDS = 20;
const BATCH_SIZE = 20;
const OUTPUT_LIMIT = 64 * 1024;

interface Judge0Submission {
  token: string;
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
}

/**
 * Sandboxed execution via Judge0 CE (FRD §4.7). Each test case is one Judge0
 * submission (created in batches, then polled). Judge0 runs code in
 * isolate sandboxes with per-submission CPU time, wall time and memory
 * limits and no network. Output comparison is done by the judge (we don't
 * send `expected_output`), so Judge0's status only says how the program ran.
 */
export class Judge0CodeRunner implements CodeRunner {
  readonly name = 'judge0';
  private readonly logger = new Logger(Judge0CodeRunner.name);
  private readonly base: string;

  constructor(
    private readonly config: Judge0Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep = (ms: number) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {
    this.base = config.url.replace(/\/+$/, '');
  }

  async run(req: CodeRunRequest): Promise<CodeRunResult> {
    const cpu = Math.min(MAX_CPU_SECONDS, req.timeLimitMs / 1000);
    const memoryKb = req.memoryLimitMb * 1024;
    const submissions = req.inputs.map((input) => ({
      language_id: LANGUAGES[req.language].judge0Id,
      source_code: b64(req.source),
      stdin: b64(input),
      cpu_time_limit: cpu,
      wall_time_limit: Math.min(MAX_WALL_SECONDS, cpu * 2 + 1),
      memory_limit: memoryKb,
      // KB. Judge0's maximum (default is 64 MB): room for deep recursion.
      stack_limit: 128_000,
      redirect_stderr_to_stdout: false,
      enable_network: false,
    }));

    const deadline = Date.now() + this.config.timeoutMs;
    const results: Judge0Submission[] = [];
    for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
      const created = await this.request<{ token?: string; error?: string }[]>(
        'POST',
        '/submissions/batch?base64_encoded=true',
        { submissions: submissions.slice(i, i + BATCH_SIZE) },
      );
      const tokens = created.map((c) => {
        if (!c.token)
          throw new Error(`Judge0 rejected a submission: ${JSON.stringify(c)}`);
        return c.token;
      });
      results.push(...(await this.poll(tokens, deadline)));
    }

    const compileError = results.find((r) => r.status.id === 6);
    return {
      status: 'completed',
      compileOutput: compileError ? decode(compileError.compile_output) : null,
      outcomes: results.map((r) => this.outcome(r, memoryKb)),
    };
  }

  private async poll(tokens: string[], deadline: number) {
    const fields =
      'token,status,stdout,stderr,compile_output,message,time,memory';
    for (;;) {
      const { submissions } = await this.request<{
        submissions: Judge0Submission[];
      }>(
        'GET',
        `/submissions/batch?tokens=${tokens.join(',')}&base64_encoded=true&fields=${fields}`,
      );
      // Status 1 = In Queue, 2 = Processing; everything else is final.
      if (submissions.every((s) => s.status.id > 2)) {
        const byToken = new Map(submissions.map((s) => [s.token, s]));
        return tokens.map((t) => byToken.get(t)!);
      }
      if (Date.now() > deadline) {
        throw new Error('Judge0 did not finish in time');
      }
      await this.sleep(this.config.pollIntervalMs ?? 500);
    }
  }

  /** Maps Judge0 statuses (see GET /statuses) to how the program ran. */
  private outcome(s: Judge0Submission, memoryLimitKb: number): TestOutcome {
    const base = {
      stdout: decode(s.stdout),
      stderr: decode(s.stderr) || decode(s.message),
      timeMs: s.time === null ? null : Math.round(Number(s.time) * 1000),
      memoryKb: s.memory,
    };
    const id = s.status.id;
    if (id === 3 || id === 4) return { ...base, status: 'ok' };
    if (id === 5) return { ...base, status: 'time_limit' };
    if (id === 6) return { ...base, status: 'compile_error' };
    if (id >= 7 && id <= 12) {
      // Judge0 has no MLE status: running out of memory surfaces as a crash
      // (SIGSEGV/SIGABRT/NZEC) with usage at the limit.
      const outOfMemory =
        (s.memory !== null && s.memory >= memoryLimitKb * 0.95) ||
        /out of memory|MemoryError|OutOfMemoryError|bad_alloc/i.test(
          base.stderr,
        );
      return {
        ...base,
        status: outOfMemory ? 'memory_limit' : 'runtime_error',
      };
    }
    this.logger.warn(`Judge0 internal status ${id}: ${s.status.description}`);
    return { ...base, status: 'internal_error' };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken && {
          [this.config.authHeader]: this.config.authToken,
        }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Judge0 ${method} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as T;
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const decode = (s: string | null) =>
  s ? Buffer.from(s, 'base64').toString('utf8').slice(0, OUTPUT_LIMIT) : '';
