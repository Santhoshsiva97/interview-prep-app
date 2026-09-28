import type { FieldProblem } from '../../question-bank/models/question-content.js';

export const EXAM_LIMITS = {
  sections: 20,
  questionsPerSection: 200,
  questionsPerExam: 500,
  durationMinutes: 600,
} as const;

export interface ExamShape {
  durationMinutes: number;
  sectionTimed: boolean;
  sections: {
    durationMinutes?: number | null;
    questionIds: string[];
  }[];
}

/** What the rules need to know about each referenced question. */
export interface QuestionFacts {
  exists: boolean;
  /** Has a published (live) version candidates can be given. */
  live: boolean;
}

/**
 * Cross-field rules for an exam (single-field rules live on the DTOs).
 * `publishing` adds the rules a candidate-facing exam must meet; drafts may
 * be incomplete.
 */
export function examProblems(
  exam: ExamShape,
  questions: Map<string, QuestionFacts>,
  { publishing }: { publishing: boolean },
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const seen = new Map<string, string>();
  let total = 0;

  exam.sections.forEach((section, s) => {
    const at = `sections[${s}]`;
    if (exam.sectionTimed && !section.durationMinutes) {
      problems.push({
        field: `${at}.durationMinutes`,
        message: 'Timed sections each need a time limit',
      });
    }
    if (publishing && section.questionIds.length === 0) {
      problems.push({
        field: `${at}.questionIds`,
        message: 'Add at least one question to this section',
      });
    }
    section.questionIds.forEach((id, i) => {
      const field = `${at}.questionIds[${i}]`;
      total += 1;
      const facts = questions.get(id);
      if (!facts?.exists) {
        problems.push({ field, message: 'Question not found' });
        return;
      }
      if (seen.has(id)) {
        problems.push({
          field,
          message: `This question is already in the exam (${seen.get(id)})`,
        });
      }
      seen.set(id, `section ${s + 1}`);
      if (publishing && !facts.live) {
        problems.push({
          field,
          message: 'This question has no published version yet',
        });
      }
    });
  });

  if (total > EXAM_LIMITS.questionsPerExam) {
    problems.push({
      field: 'sections',
      message: `An exam can hold at most ${EXAM_LIMITS.questionsPerExam} questions`,
    });
  }
  if (exam.sectionTimed) {
    const sum = exam.sections.reduce((a, x) => a + (x.durationMinutes ?? 0), 0);
    if (sum > EXAM_LIMITS.durationMinutes) {
      problems.push({
        field: 'sections',
        message: `Section time limits add up to more than ${EXAM_LIMITS.durationMinutes} minutes`,
      });
    }
  }
  if (publishing && exam.sections.length === 0) {
    problems.push({ field: 'sections', message: 'Add at least one section' });
  }
  return problems;
}

/** Total time for the exam: the section limits when section-timed. */
export const effectiveDuration = (exam: ExamShape) =>
  exam.sectionTimed
    ? exam.sections.reduce((a, x) => a + (x.durationMinutes ?? 0), 0)
    : exam.durationMinutes;
