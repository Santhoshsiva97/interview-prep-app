-- CreateEnum
CREATE TYPE "exam_kind" AS ENUM ('mock_exam', 'virtual_interview');

-- CreateEnum
CREATE TYPE "exam_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "exam_session_status" AS ENUM ('in_progress', 'submitted');

-- CreateEnum
CREATE TYPE "exam_submit_reason" AS ENUM ('manual', 'time_expired', 'abandoned');

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "kind" "exam_kind" NOT NULL DEFAULT 'mock_exam',
    "status" "exam_status" NOT NULL DEFAULT 'draft',
    "description" VARCHAR(1000),
    "instructions" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "section_timed" BOOLEAN NOT NULL DEFAULT false,
    "pause_on_disconnect" BOOLEAN NOT NULL DEFAULT true,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
    "max_attempts" INTEGER,
    "pass_percent" SMALLINT,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "duration_minutes" INTEGER,
    "marks_per_question" INTEGER,
    "negative_mark_percent" SMALLINT NOT NULL DEFAULT 0,
    "partial_scoring" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "section_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "question_id" UUID NOT NULL,
    "question_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exam_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "exam_session_status" NOT NULL DEFAULT 'in_progress',
    "consented_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "time_remaining_ms" INTEGER NOT NULL,
    "section_remaining_ms" INTEGER,
    "current_section_index" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "submit_reason" "exam_submit_reason",
    "snapshot" JSONB NOT NULL,
    "total_marks" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "section_index" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "question_id" UUID NOT NULL,
    "question_version_id" UUID NOT NULL,
    "type" "question_type" NOT NULL,
    "marks" INTEGER NOT NULL,
    "negative_mark_percent" SMALLINT NOT NULL,
    "partial_scoring" BOOLEAN NOT NULL,
    "option_order" JSONB,
    "response" JSONB,
    "marked_for_review" BOOLEAN NOT NULL DEFAULT false,
    "visited_at" TIMESTAMPTZ(6),
    "answered_at" TIMESTAMPTZ(6),
    "time_spent_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_session_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_session_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_session_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exams_status_kind_idx" ON "exams"("status", "kind");

-- CreateIndex
CREATE INDEX "exams_created_at_idx" ON "exams"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sections_exam_id_position_key" ON "exam_sections"("exam_id", "position");

-- CreateIndex
CREATE INDEX "exam_items_question_id_idx" ON "exam_items"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_items_section_id_position_key" ON "exam_items"("section_id", "position");

-- CreateIndex
CREATE INDEX "exam_sessions_user_id_status_idx" ON "exam_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "exam_sessions_exam_id_idx" ON "exam_sessions"("exam_id");

-- CreateIndex
CREATE INDEX "exam_sessions_status_last_synced_at_idx" ON "exam_sessions"("status", "last_synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_user_id_exam_id_attempt_number_key" ON "exam_sessions"("user_id", "exam_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "exam_session_items_session_id_section_index_position_key" ON "exam_session_items"("session_id", "section_index", "position");

-- CreateIndex
CREATE INDEX "exam_session_events_session_id_created_at_idx" ON "exam_session_events"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "exam_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_items" ADD CONSTRAINT "exam_session_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_items" ADD CONSTRAINT "exam_session_items_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_items" ADD CONSTRAINT "exam_session_items_question_version_id_fkey" FOREIGN KEY ("question_version_id") REFERENCES "question_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_session_events" ADD CONSTRAINT "exam_session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
