-- Backend consistency migration.
-- Existing data is validated before constraints are added. Any conflict aborts
-- the migration instead of silently choosing a state or deleting history.

BEGIN;

CREATE TYPE "SubscriptionPlan" AS ENUM ('trial', 'monthly', 'quarterly');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users" u
    JOIN "subscriptions" s ON s."userId" = u."id"
    WHERE u."subscriptionStatus"::text <> s."status"::text
  ) THEN
    RAISE EXCEPTION 'subscription status conflict between users and subscriptions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users" u
    LEFT JOIN "subscriptions" s ON s."userId" = u."id"
    WHERE u."subscriptionStatus" = 'active' AND s."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'active user has no subscription row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "subscriptions"
    WHERE "status" = 'active' AND ("plan" IS NULL OR "paidAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'active subscription requires plan and paidAt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "subscriptions"
    WHERE "plan" IS NOT NULL AND "plan" NOT IN ('trial', 'monthly', 'quarterly')
  ) THEN
    RAISE EXCEPTION 'subscription contains an unsupported plan';
  END IF;
END $$;

ALTER TABLE "results"
  ADD COLUMN "assessmentId" TEXT,
  ADD COLUMN "sourceAssessmentVersion" INTEGER,
  ADD COLUMN "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "algorithmVersion" TEXT NOT NULL DEFAULT 'v1';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "results" r
    LEFT JOIN "assessments" a ON a."userId" = r."userId"
    WHERE a."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'result has no assessment history to bind';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "assessments"
    WHERE "version" < 0 OR "step" < 0
  ) THEN
    RAISE EXCEPTION 'assessment contains a negative version or step';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "assessments"
    WHERE "completed" = true
      AND ("gender" IS NULL OR "goal" IS NULL OR "age" IS NULL OR "heightCm" IS NULL
        OR "weightKg" IS NULL OR "targetWeightKg" IS NULL OR "activityLevel" IS NULL)
  ) THEN
    RAISE EXCEPTION 'completed assessment is missing required health fields';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "assessment_answers"
    WHERE num_nonnulls("valueText", "valueNumber", "valueBoolean", "valueJson") <> 1
  ) THEN
    RAISE EXCEPTION 'assessment answer must contain exactly one value';
  END IF;
END $$;

UPDATE "results" r
SET "assessmentId" = a."id"
FROM "assessments" a
WHERE a."userId" = r."userId";

ALTER TABLE "results"
  ALTER COLUMN "assessmentId" SET NOT NULL;

CREATE UNIQUE INDEX "results_assessmentId_key" ON "results"("assessmentId");
ALTER TABLE "results"
  ADD CONSTRAINT "results_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscriptions"
  ALTER COLUMN "plan" TYPE "SubscriptionPlan"
  USING "plan"::"SubscriptionPlan";

ALTER TABLE "users" DROP COLUMN "subscriptionStatus";

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_version_nonnegative_check" CHECK ("version" >= 0),
  ADD CONSTRAINT "assessments_step_nonnegative_check" CHECK ("step" >= 0),
  ADD CONSTRAINT "assessments_completed_requires_core_check" CHECK (
    NOT "completed" OR (
      "gender" IS NOT NULL AND "goal" IS NOT NULL AND "age" IS NOT NULL
      AND "heightCm" IS NOT NULL AND "weightKg" IS NOT NULL
      AND "targetWeightKg" IS NOT NULL AND "activityLevel" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "assessments_age_range_check" CHECK ("age" IS NULL OR "age" BETWEEN 13 AND 120),
  ADD CONSTRAINT "assessments_height_range_check" CHECK (
    "heightCm" IS NULL OR ("heightCm"::text NOT IN ('NaN', 'Infinity', '-Infinity') AND "heightCm" BETWEEN 50 AND 300)
  ),
  ADD CONSTRAINT "assessments_weight_range_check" CHECK (
    "weightKg" IS NULL OR ("weightKg"::text NOT IN ('NaN', 'Infinity', '-Infinity') AND "weightKg" BETWEEN 20 AND 500)
  ),
  ADD CONSTRAINT "assessments_target_weight_range_check" CHECK (
    "targetWeightKg" IS NULL OR ("targetWeightKg"::text NOT IN ('NaN', 'Infinity', '-Infinity') AND "targetWeightKg" BETWEEN 20 AND 500)
  );

ALTER TABLE "assessment_answers"
  ADD CONSTRAINT "assessment_answers_exactly_one_value_check"
  CHECK (num_nonnulls("valueText", "valueNumber", "valueBoolean", "valueJson") = 1);

ALTER TABLE "results"
  ADD CONSTRAINT "results_bmi_positive_check" CHECK (
    "bmi"::text NOT IN ('NaN', 'Infinity', '-Infinity') AND "bmi" > 0
  ),
  ADD CONSTRAINT "results_calories_positive_check" CHECK ("recommendedCalories" > 0);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_status_fields_check" CHECK (
    ("status" = 'free' AND "plan" IS NULL AND "paidAt" IS NULL)
    OR ("status" = 'active' AND "plan" IS NOT NULL AND "paidAt" IS NOT NULL)
  );

COMMIT;
