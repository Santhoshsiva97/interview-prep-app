import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import { SOURCE_MAX_BYTES } from '../../exams/models/session-content.js';
import { CODING_LANGUAGES } from '../../question-bank/models/question-content.js';

export const JUDGE_QUEUE = 'judge';

/** BullMQ job payloads on the `judge` queue. */
export type JudgeJob =
  { type: 'run'; submissionId: string } | { type: 'grade'; sessionId: string };

/** POST /exam-sessions/:id/runs */
export class RunCodeDto {
  @IsUUID()
  itemId: string;

  @IsIn(CODING_LANGUAGES)
  language: (typeof CODING_LANGUAGES)[number];

  @IsString()
  @MaxLength(SOURCE_MAX_BYTES)
  code: string;
}

/** One test case as stored in code_submissions.results. */
export interface StoredTestResult {
  index: number;
  isSample: boolean;
  verdict: 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'IE';
  timeMs: number | null;
  memoryKb: number | null;
  stdout: string;
  stderr: string;
  /** Kept for sample tests only (shown to the candidate next to their output). */
  input?: string;
  expectedOutput?: string;
}
