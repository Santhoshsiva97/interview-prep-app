import { Injectable } from '@nestjs/common';
import type { CodingLanguage } from '../../question-bank/models/question-content.js';
import type { TestOutcome } from '../models/judging.js';

export interface CodeRunRequest {
  language: CodingLanguage;
  source: string;
  /** stdin per test case. Output comparison happens in the judge, not the runner. */
  inputs: string[];
  /** Effective limits for this language (see `effectiveLimits`). */
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface CodeRunResult {
  /** `unavailable`: this runner can't execute the language (or code at all). */
  status: 'completed' | 'unavailable';
  message?: string;
  /** Compiler output when compilation failed. */
  compileOutput?: string | null;
  /** One per input, in order (empty when unavailable). */
  outcomes: TestOutcome[];
}

/**
 * Executes candidate code (FRD §4.7). Implementations: Judge0 (production
 * sandbox), a dev-only local process runner, and "unavailable". Throwing
 * means "try again later" (the job is retried); `unavailable` is final.
 */
export interface CodeRunner {
  readonly name: string;
  run(request: CodeRunRequest): Promise<CodeRunResult>;
}

export const CODE_RUNNER = Symbol('CODE_RUNNER');

/** `CODE_RUNNER=disabled`: nothing is executed. */
@Injectable()
export class UnavailableCodeRunner implements CodeRunner {
  readonly name = 'disabled';

  run(): Promise<CodeRunResult> {
    return Promise.resolve({
      status: 'unavailable',
      message:
        'Running code isn’t available on this server. Your code is still saved with your answers.',
      outcomes: [],
    });
  }
}
