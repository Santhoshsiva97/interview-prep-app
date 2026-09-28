import {
  effectiveDuration,
  examProblems,
  type QuestionFacts,
} from './exam-rules.js';

const facts = new Map<string, QuestionFacts>([
  ['q1', { exists: true, live: true }],
  ['q2', { exists: true, live: true }],
  ['draft', { exists: true, live: false }],
]);

describe('examProblems', () => {
  it('lets drafts be incomplete but not wrong', () => {
    expect(
      examProblems(
        { durationMinutes: 30, sectionTimed: false, sections: [] },
        facts,
        { publishing: false },
      ),
    ).toEqual([]);
    expect(
      examProblems(
        {
          durationMinutes: 30,
          sectionTimed: false,
          sections: [{ questionIds: ['draft', 'missing'] }],
        },
        facts,
        { publishing: false },
      ),
    ).toEqual([
      { field: 'sections[0].questionIds[1]', message: 'Question not found' },
    ]);
  });

  it('publishing needs sections, questions and live versions', () => {
    const fields = (sections: { questionIds: string[] }[]) =>
      examProblems(
        { durationMinutes: 30, sectionTimed: false, sections },
        facts,
        {
          publishing: true,
        },
      ).map((p) => p.field);
    expect(fields([])).toEqual(['sections']);
    expect(fields([{ questionIds: [] }])).toEqual(['sections[0].questionIds']);
    expect(fields([{ questionIds: ['q1', 'draft'] }])).toEqual([
      'sections[0].questionIds[1]',
    ]);
  });

  it('rejects the same question twice, even across sections', () => {
    const problems = examProblems(
      {
        durationMinutes: 30,
        sectionTimed: false,
        sections: [{ questionIds: ['q1'] }, { questionIds: ['q2', 'q1'] }],
      },
      facts,
      { publishing: false },
    );
    expect(problems).toEqual([
      {
        field: 'sections[1].questionIds[1]',
        message: 'This question is already in the exam (section 1)',
      },
    ]);
  });

  it('timed sections each need a limit and can’t exceed the maximum together', () => {
    const exam = {
      durationMinutes: 30,
      sectionTimed: true,
      sections: [
        { durationMinutes: 400, questionIds: ['q1'] },
        { durationMinutes: 300, questionIds: ['q2'] },
        { durationMinutes: null, questionIds: [] },
      ],
    };
    expect(examProblems(exam, facts, { publishing: false })).toEqual([
      {
        field: 'sections[2].durationMinutes',
        message: 'Timed sections each need a time limit',
      },
      {
        field: 'sections',
        message: 'Section time limits add up to more than 600 minutes',
      },
    ]);
    expect(effectiveDuration(exam)).toBe(700);
    expect(effectiveDuration({ ...exam, sectionTimed: false })).toBe(30);
  });
});
