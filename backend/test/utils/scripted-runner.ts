import type {
  CodeRunner,
  CodeRunRequest,
  CodeRunResult,
} from '../../src/modules/judge/runners/code-runner.js';

/**
 * The "program" is the source text: `echo` prints its input, `wrong` prints
 * junk, `ce` doesn't compile, `tle` loops forever. `mode` simulates the
 * judge being down (`throw`) or not configured (`unavailable`).
 */
export class ScriptedRunner implements CodeRunner {
  readonly name = 'scripted';
  mode: 'ok' | 'throw' | 'unavailable' = 'ok';
  calls: CodeRunRequest[] = [];

  run(req: CodeRunRequest): Promise<CodeRunResult> {
    this.calls.push(req);
    if (this.mode === 'throw')
      return Promise.reject(new Error('Judge0 POST /submissions/batch → 503'));
    if (this.mode === 'unavailable')
      return Promise.resolve({
        status: 'unavailable',
        message: 'Running code isn’t available on this server.',
        outcomes: [],
      });
    const program = req.source.trim();
    const run = (input: string) => {
      const base = { stderr: '', timeMs: 5, memoryKb: 1024 };
      if (program === 'ce')
        return { ...base, status: 'compile_error' as const, stdout: '' };
      if (program === 'tle')
        return { ...base, status: 'time_limit' as const, stdout: '' };
      return {
        ...base,
        status: 'ok' as const,
        stdout: program === 'echo' ? `${input}\n` : 'junk\n',
      };
    };
    return Promise.resolve({
      status: 'completed',
      compileOutput: program === 'ce' ? 'error: expected ;' : null,
      outcomes: req.inputs.map(run),
    });
  }
}
