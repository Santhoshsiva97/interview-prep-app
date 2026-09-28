-- CreateEnum
CREATE TYPE "answer_review_policy" AS ENUM ('full', 'own_answers', 'none');

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "answer_review" "answer_review_policy" NOT NULL DEFAULT 'full';

-- CreateTable
CREATE TABLE "scorecards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "score_centi" INTEGER NOT NULL,
    "max_score_centi" INTEGER NOT NULL,
    "percent_bp" INTEGER NOT NULL,
    "passed" BOOLEAN,
    "percentile_bp" INTEGER NOT NULL,
    "cohort_size" INTEGER NOT NULL,
    "percentile_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sections" JSONB NOT NULL,
    "topics" JSONB NOT NULL,
    "time_spent_ms" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scorecards_session_id_key" ON "scorecards"("session_id");

-- CreateIndex
CREATE INDEX "scorecards_user_id_submitted_at_idx" ON "scorecards"("user_id", "submitted_at");

-- CreateIndex
CREATE INDEX "scorecards_exam_id_attempt_number_score_centi_idx" ON "scorecards"("exam_id", "attempt_number", "score_centi");

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
