import { Injectable, Logger } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { CodingLanguage } from '../../question-bank/models/question-content.js';
import { outputsMatch } from '../models/session-content.js';

export interface CodeRunRequest {
  language: CodingLanguage;
  source: string;
  tests: { input: string; expectedOutput: string }[];
  timeLimitMs: number;
  memoryLimitMb: number;
}

export type RunVerdict =
  'passed' | 'failed' | 'runtime_error' | 'time_limit' | 'unsupported';

export interface CodeRunResult {
  /** `unavailable`: this server can't execute code (the judge arrives in Step 8). */
  status: 'completed' | 'unavailable';
  message?: string;
  results: {
    verdict: RunVerdict;
    stdout: string;
    stderr: string;
    timeMs: number;
  }[];
}

/**
 * Executes candidate code against test cases. Step 7 uses it for "Run"
 * (sample cases only). STEP 8 HOOK: bind a sandboxed judge (Judge0 or
 * Docker workers) to CODE_RUNNER in exams.module.ts; callers don't change.
 */
export interface CodeRunner {
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}

export const CODE_RUNNER = Symbol('CODE_RUNNER');

/** Default until the judge exists: reports that running code is unavailable. */
@Injectable()
export class UnavailableCodeRunner implements CodeRunner {
  run(): Promise<CodeRunResult> {
    return Promise.resolve({
      status: 'unavailable',
      message:
        'Running code isn’t available on this server yet. Your code is still saved with your answers.',
      results: [],
    });
  }
}

const OUTPUT_LIMIT = 64 * 1024;

/**
 * Absolute path of a real Python interpreter, or null. Asked once with the
 * normal environment: `python`/`python3` may be launcher shims (Windows
 * App Execution Aliases, the Python install manager) that misbehave — even
 * start downloading Python — when run with the stripped-down run environment.
 */
function resolvePython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const r = spawnSync(
      candidate,
      ['-c', 'import sys; print(sys.executable)'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    const path = r.status === 0 ? r.stdout.trim() : '';
    if (path && isAbsolute(path) && existsSync(path)) return path;
  }
  return null;
}

/**
 * DEV ONLY (`CODE_RUNNER=local`, refused in production by config
 * validation). Runs JavaScript (Node) and Python as plain child processes
 * with a time limit. This is NOT a sandbox: the code runs with the API
 * server's permissions. Java/C++ report `unsupported`.
 */
@Injectable()
export class LocalProcessCodeRunner implements CodeRunner {
  private readonly logger = new Logger(LocalProcessCodeRunner.name);
  private python: string | null | undefined;

  constructor() {
    this.logger.warn(
      'CODE_RUNNER=local: candidate code runs unsandboxed. Never enable this outside development.',
    );
  }

  async run(req: CodeRunRequest): Promise<CodeRunResult> {
    const command = this.command(req);
    if (!command) {
      return {
        status: 'completed',
        message: `Running ${req.language} needs the code judge (not set up on this server).`,
        results: req.tests.map(() => ({
          verdict: 'unsupported',
          stdout: '',
          stderr: '',
          timeMs: 0,
        })),
      };
    }
    const dir = await mkdtemp(join(tmpdir(), 'exam-run-'));
    try {
      const file = join(dir, command.file);
      await writeFile(file, req.source, 'utf8');
      const results: CodeRunResult['results'] = [];
      for (const test of req.tests) {
        const r = await this.exec(command.cmd, [...command.args, file], {
          cwd: dir,
          input: test.input,
          // Allow for interpreter start-up on top of the question's limit.
          timeoutMs: Math.min(req.timeLimitMs + 1000, 10_000),
        });
        results.push({
          verdict: r.timedOut
            ? 'time_limit'
            : r.code !== 0
              ? 'runtime_error'
              : outputsMatch(r.stdout, test.expectedOutput)
                ? 'passed'
                : 'failed',
          stdout: r.stdout,
          stderr: r.stderr,
          timeMs: r.timeMs,
        });
      }
      return { status: 'completed', results };
    } finally {
      await rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      }).catch(() => undefined);
    }
  }

  private command(req: CodeRunRequest) {
    if (req.language === 'javascript') {
      return {
        cmd: process.execPath,
        args: [`--max-old-space-size=${req.memoryLimitMb}`],
        file: 'main.js',
      };
    }
    if (req.language === 'python') {
      this.python ??= resolvePython();
      return this.python
        ? { cmd: this.python, args: ['-I', '-X', 'utf8'], file: 'main.py' }
        : null;
    }
    return null;
  }

  private exec(
    cmd: string,
    args: string[],
    opts: { cwd: string; input: string; timeoutMs: number },
  ) {
    return new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
      timeMs: number;
    }>((resolve) => {
      const started = Date.now();
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        // Minimal environment: nothing from the API's config leaks in. The
        // command is always an absolute interpreter path, never a launcher.
        env: {
          SYSTEMROOT: process.env.SYSTEMROOT,
          TEMP: opts.cwd,
          TMP: opts.cwd,
        },
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const cap = (s: string, chunk: Buffer) =>
        s.length < OUTPUT_LIMIT
          ? (s + chunk.toString('utf8')).slice(0, OUTPUT_LIMIT)
          : s;
      child.stdout.on('data', (c: Buffer) => (stdout = cap(stdout, c)));
      child.stderr.on('data', (c: Buffer) => (stderr = cap(stderr, c)));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
      child.on('error', (err) => {
        stderr += err.message;
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code,
          stdout,
          stderr,
          timedOut,
          timeMs: Date.now() - started,
        });
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input);
    });
  }
}
