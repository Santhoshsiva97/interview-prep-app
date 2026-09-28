-- CreateTable
CREATE TABLE "question_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL,
    "answered" INTEGER NOT NULL,
    "correct" INTEGER NOT NULL,
    "partial" INTEGER NOT NULL,
    "incorrect" INTEGER NOT NULL,
    "accuracy_bp" INTEGER NOT NULL,
    "avg_score_bp" INTEGER NOT NULL,
    "avg_time_ms" INTEGER NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(6),
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "question_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_stats_question_id_key" ON "question_stats"("question_id");

-- CreateIndex
CREATE INDEX "question_stats_accuracy_bp_idx" ON "question_stats"("accuracy_bp");

-- CreateIndex
CREATE INDEX "question_stats_attempts_idx" ON "question_stats"("attempts");

-- AddForeignKey
ALTER TABLE "question_stats" ADD CONSTRAINT "question_stats_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
