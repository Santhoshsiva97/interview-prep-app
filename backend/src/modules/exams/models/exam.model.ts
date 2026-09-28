import type { Prisma } from '../../../generated/prisma/client.js';

/** Everything needed to show, validate or start an exam. */
export const examDetailInclude = {
  sections: {
    orderBy: { position: 'asc' },
    include: {
      items: {
        orderBy: { position: 'asc' },
        include: {
          question: {
            select: {
              id: true,
              title: true,
              type: true,
              status: true,
              difficulty: true,
              deletedAt: true,
              topic: { select: { id: true, name: true } },
              publishedVersion: { select: { id: true, versionNumber: true } },
            },
          },
          questionVersion: {
            select: {
              id: true,
              versionNumber: true,
              marks: true,
              title: true,
              body: true,
              difficulty: true,
              content: true,
            },
          },
        },
      },
    },
  },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
} satisfies Prisma.ExamInclude;

export type ExamWithSections = Prisma.ExamGetPayload<{
  include: typeof examDetailInclude;
}>;

type Section = ExamWithSections['sections'][number];

/** Marks a correct answer earns: the section override, else the pinned version's. */
export const itemMarks = (
  section: Pick<Section, 'marksPerQuestion'>,
  item: { questionVersion: { marks: number } | null },
) => section.marksPerQuestion ?? item.questionVersion?.marks ?? 0;

export const totalMarks = (exam: ExamWithSections) =>
  exam.sections.reduce(
    (a, s) => a + s.items.reduce((b, i) => b + itemMarks(s, i), 0),
    0,
  );

export const questionCount = (exam: { sections: { items: unknown[] }[] }) =>
  exam.sections.reduce((a, s) => a + s.items.length, 0);
