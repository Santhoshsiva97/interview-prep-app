import { Injectable, Logger } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { TestOutcome } from '../models/judging.js';
import { LANGUAGES } from '../models/judging.js';
import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
} from './code-runner.js';

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
      {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    const path = r.status === 0 ? r.stdout.trim() : '';
    if (path && isAbsolute(path) && existsSync(path)) return path;
  }
  return null;
}

/**
 * DEV ONLY (`CODE_RUNNER=local`, refused in production by config
 * validation). Runs JavaScript (Node) and Python as plain child processes
 * with a wall-clock limit. This is NOT a sandbox: the code runs with the API
 * server's permissions, and memory isn't measured (Node's heap limit is set;
 * running out of it reports MLE). Java/C++ are `unavailable` here.
 */
@Injectable()
export class LocalProcessCodeRunner implements CodeRunner {
  readonly name = 'local';
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
        status: 'unavailable',
        message: `Running ${req.language} needs the code judge (not set up on this server).`,
        outcomes: [],
      };
    }
    const dir = await mkdtemp(join(tmpdir(), 'exam-run-'));
    try {
      const file = join(dir, LANGUAGES[req.language].file);
      await writeFile(file, req.source, 'utf8');
      const outcomes: TestOutcome[] = [];
      for (const input of req.inputs) {
        const r = await this.exec(command.cmd, [...command.args, file], {
          cwd: dir,
          input,
          // Interpreter start-up on top of the (already language-adjusted) limit.
          timeoutMs: req.timeLimitMs + 500,
        });
        outcomes.push({
          status: r.timedOut
            ? 'time_limit'
            : r.code === 0
              ? 'ok'
              : /heap out of memory|MemoryError/.test(r.stderr)
                ? 'memory_limit'
                : 'runtime_error',
          stdout: r.stdout,
          stderr: r.stderr,
          timeMs: r.timeMs,
          memoryKb: null,
        });
      }
      return { status: 'completed', outcomes };
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
      };
    }
    if (req.language === 'python') {
      this.python ??= resolvePython();
      return this.python
        ? { cmd: this.python, args: ['-I', '-X', 'utf8'] }
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
