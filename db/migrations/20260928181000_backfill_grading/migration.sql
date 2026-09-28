-- Attempts submitted before the judge existed (Step 7) were never queued for
-- grading. Mark them pending: the judge's recovery sweep grades them.
UPDATE "exam_sessions" SET "grading_status" = 'pending' WHERE "status" = 'submitted' AND "grading_status" IS NULL;
