-- CreateEnum
CREATE TYPE "grading_status" AS ENUM ('pending', 'grading', 'graded', 'failed');

-- CreateEnum
CREATE TYPE "item_outcome" AS ENUM ('correct', 'partial', 'incorrect', 'unanswered');

-- CreateEnum
CREATE TYPE "test_verdict" AS ENUM ('AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'IE');

-- CreateEnum
CREATE TYPE "code_submission_kind" AS ENUM ('run', 'grade');

-- CreateEnum
CREATE TYPE "code_submission_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- AlterTable
ALTER TABLE "exam_session_items" ADD COLUMN     "graded_at" TIMESTAMPTZ(6),
ADD COLUMN     "outcome" "item_outcome",
ADD COLUMN     "score_centi" INTEGER;

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "graded_at" TIMESTAMPTZ(6),
ADD COLUMN     "grading_error" VARCHAR(1000),
ADD COLUMN     "grading_status" "grading_status",
ADD COLUMN     "score_centi" INTEGER;

-- CreateTable
CREATE TABLE "code_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "session_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "code_submission_kind" NOT NULL,
    "status" "code_submission_status" NOT NULL DEFAULT 'queued',
    "language" VARCHAR(20) NOT NULL,
    "source" TEXT NOT NULL,
    "verdict" "test_verdict",
    "passed_count" INTEGER,
    "total_count" INTEGER,
    "passed_weight" INTEGER,
    "total_weight" INTEGER,
    "compile_output" TEXT,
    "results" JSONB,
    "error" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "code_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_submissions_session_id_kind_idx" ON "code_submissions"("session_id", "kind");

-- CreateIndex
CREATE INDEX "code_submissions_session_item_id_created_at_idx" ON "code_submissions"("session_item_id", "created_at");

-- CreateIndex
CREATE INDEX "code_submissions_status_idx" ON "code_submissions"("status");

-- AddForeignKey
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_session_item_id_fkey" FOREIGN KEY ("session_item_id") REFERENCES "exam_session_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
