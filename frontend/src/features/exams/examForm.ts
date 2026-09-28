import type { Difficulty } from '../questions/api';
import type { ExamDetail, ExamInput, ExamKind } from './api';

/** A question as shown in the builder (from the exam, or just picked). */
export interface PickedQuestion {
  questionId: string;
  title: string;
  type: 'mcq' | 'coding';
  difficulty: Difficulty;
  topicName: string;
  /** Question's own marks; unknown for freshly picked ones until saved. */
  marks: number | null;
  pinnedVersion: number | null;
  liveVersion: number | null;
}

export interface SectionForm {
  /** Local key for React lists (sections are replaced wholesale on save). */
  key: string;
  title: string;
  description: string;
  durationMinutes: string;
  marksPerQuestion: string;
  negativeMarkPercent: string;
  partialScoring: boolean;
  questions: PickedQuestion[];
}

export interface ExamForm {
  title: string;
  kind: ExamKind;
  description: string;
  instructions: string;
  durationMinutes: string;
  sectionTimed: boolean;
  pauseOnDisconnect: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxAttempts: string;
  passPercent: string;
  answerReview: ExamInput['answerReview'];
  sections: SectionForm[];
}

let seq = 0;
const key = () => `s${++seq}`;

export const blankSection = (n: number): SectionForm => ({
  key: key(),
  title: `Section ${n}`,
  description: '',
  durationMinutes: '',
  marksPerQuestion: '',
  negativeMarkPercent: '0',
  partialScoring: true,
  questions: [],
});

export const DEFAULT_INSTRUCTIONS = [
  '- Read each question carefully before answering.',
  '- Your answers are saved automatically as you go.',
  '- You can mark questions for review and come back to them before submitting.',
  '- The test is submitted automatically when time runs out.',
].join('\n');

export const blankExam = (): ExamForm => ({
  title: '',
  kind: 'mock_exam',
  description: '',
  instructions: DEFAULT_INSTRUCTIONS,
  durationMinutes: '60',
  sectionTimed: false,
  pauseOnDisconnect: true,
  shuffleQuestions: false,
  shuffleOptions: false,
  maxAttempts: '',
  passPercent: '',
  answerReview: 'full',
  sections: [blankSection(1)],
});

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function formFromExam(e: ExamDetail): ExamForm {
  return {
    title: e.title,
    kind: e.kind,
    description: e.description ?? '',
    instructions: e.instructions,
    durationMinutes: String(e.durationMinutes),
    sectionTimed: e.sectionTimed,
    pauseOnDisconnect: e.pauseOnDisconnect,
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    maxAttempts: str(e.maxAttempts),
    passPercent: str(e.passPercent),
    answerReview: e.answerReview,
    sections: e.sections.map((s) => ({
      key: key(),
      title: s.title,
      description: s.description ?? '',
      durationMinutes: str(s.durationMinutes),
      marksPerQuestion: str(s.marksPerQuestion),
      negativeMarkPercent: String(s.negativeMarkPercent),
      partialScoring: s.partialScoring,
      questions: s.items.map((i) => ({
        questionId: i.questionId,
        title: i.title,
        type: i.type,
        difficulty: i.difficulty,
        topicName: i.topic.name,
        // The item's marks include the section override; recover the question's own.
        marks: s.marksPerQuestion === null ? i.marks : null,
        pinnedVersion: i.pinnedVersion,
        liveVersion: i.liveVersion,
      })),
    })),
  };
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));

export function formToInput(f: ExamForm): ExamInput {
  return {
    title: f.title,
    kind: f.kind,
    description: f.description.trim() || null,
    instructions: f.instructions,
    durationMinutes: f.sectionTimed
      ? Math.max(1, sectionTotal(f))
      : (num(f.durationMinutes) ?? 0),
    sectionTimed: f.sectionTimed,
    pauseOnDisconnect: f.pauseOnDisconnect,
    shuffleQuestions: f.shuffleQuestions,
    shuffleOptions: f.shuffleOptions,
    maxAttempts: num(f.maxAttempts),
    passPercent: num(f.passPercent),
    answerReview: f.answerReview,
    sections: f.sections.map((s) => ({
      title: s.title,
      description: s.description.trim() || null,
      durationMinutes: f.sectionTimed ? num(s.durationMinutes) : null,
      marksPerQuestion: num(s.marksPerQuestion),
      negativeMarkPercent: num(s.negativeMarkPercent) ?? 0,
      partialScoring: s.partialScoring,
      questionIds: s.questions.map((q) => q.questionId),
    })),
  };
}

export const sectionTotal = (f: ExamForm) =>
  f.sections.reduce((a, s) => a + (Number(s.durationMinutes) || 0), 0);

/** Comparable form (ignores local keys) for dirty checks. */
export const formKey = (f: ExamForm) => JSON.stringify(formToInput(f));

/**
 * Server problem fields look like `sections[1].questionIds[2]`. Returns the
 * section and question index they point at (if any).
 */
export function problemTarget(field: string): {
  section?: number;
  question?: number;
} {
  const m = /^sections\[(\d+)\](?:\.questionIds\[(\d+)\])?/.exec(field);
  if (!m) return {};
  return {
    section: Number(m[1]),
    question: m[2] === undefined ? undefined : Number(m[2]),
  };
}
