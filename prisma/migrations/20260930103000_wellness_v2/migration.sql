-- Wellness v2 keeps historical records readable without claiming they passed
-- the new product support gate. New submissions write the nullable fields.
ALTER TABLE "assessments"
  ADD COLUMN "wellnessEligible" BOOLEAN;

ALTER TABLE "results"
  ALTER COLUMN "targetDate" DROP NOT NULL,
  ADD COLUMN "calculationDetails" JSONB;
