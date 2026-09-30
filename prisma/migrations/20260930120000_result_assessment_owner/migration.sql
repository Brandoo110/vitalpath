-- Bind a result to the assessment and user pair so cross-user ownership cannot
-- be represented, while retaining every valid existing result.
BEGIN;

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_id_userId_key" UNIQUE ("id", "userId");

ALTER TABLE "results"
  DROP CONSTRAINT "results_assessmentId_fkey";

ALTER TABLE "results"
  ADD CONSTRAINT "results_assessmentId_userId_fkey"
  FOREIGN KEY ("assessmentId", "userId")
  REFERENCES "assessments"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
