-- 扩展问卷从 assessments 裸列迁移到可扩展的题目/答案关系模型。
CREATE TYPE "QuestionValueType" AS ENUM ('text', 'number', 'boolean', 'single_choice', 'multi_choice');

CREATE TABLE "questionnaire_questions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "valueType" "QuestionValueType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assessment_answers" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueBoolean" BOOLEAN,
    "valueJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "questionnaire_questions_key_key" ON "questionnaire_questions"("key");
CREATE UNIQUE INDEX "assessment_answers_assessmentId_questionId_key" ON "assessment_answers"("assessmentId", "questionId");
CREATE INDEX "assessment_answers_questionId_idx" ON "assessment_answers"("questionId");

ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_assessmentId_fkey"
FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "questionnaire_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "questionnaire_questions" ("id", "key", "label", "section", "valueType", "sortOrder") VALUES
('question_pace_preference', 'pacePreference', 'Preferred progress pace', 'goal', 'single_choice', 10),
('question_workout_days_per_week', 'workoutDaysPerWeek', 'Workout days per week', 'training', 'number', 20),
('question_session_minutes', 'sessionMinutes', 'Session length in minutes', 'training', 'number', 30),
('question_workout_location', 'workoutLocation', 'Training place', 'training', 'single_choice', 40),
('question_diet_preference', 'dietPreference', 'Diet preference', 'nutrition', 'single_choice', 50),
('question_sleep_hours', 'sleepHours', 'Average sleep hours', 'recovery', 'number', 60),
('question_stress_level', 'stressLevel', 'Stress level', 'recovery', 'single_choice', 70),
('question_main_barrier', 'mainBarrier', 'Main barrier', 'behavior', 'single_choice', 80);

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText")
SELECT "assessments"."id" || ':pacePreference', "assessments"."id", "questionnaire_questions"."id", "assessments"."pacePreference"::TEXT
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'pacePreference'
WHERE "assessments"."pacePreference" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueNumber")
SELECT "assessments"."id" || ':workoutDaysPerWeek', "assessments"."id", "questionnaire_questions"."id", "assessments"."workoutDaysPerWeek"::DOUBLE PRECISION
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'workoutDaysPerWeek'
WHERE "assessments"."workoutDaysPerWeek" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueNumber")
SELECT "assessments"."id" || ':sessionMinutes', "assessments"."id", "questionnaire_questions"."id", "assessments"."sessionMinutes"::DOUBLE PRECISION
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'sessionMinutes'
WHERE "assessments"."sessionMinutes" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText")
SELECT "assessments"."id" || ':workoutLocation', "assessments"."id", "questionnaire_questions"."id", "assessments"."workoutLocation"::TEXT
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'workoutLocation'
WHERE "assessments"."workoutLocation" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText")
SELECT "assessments"."id" || ':dietPreference', "assessments"."id", "questionnaire_questions"."id", "assessments"."dietPreference"::TEXT
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'dietPreference'
WHERE "assessments"."dietPreference" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueNumber")
SELECT "assessments"."id" || ':sleepHours', "assessments"."id", "questionnaire_questions"."id", "assessments"."sleepHours"::DOUBLE PRECISION
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'sleepHours'
WHERE "assessments"."sleepHours" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText")
SELECT "assessments"."id" || ':stressLevel', "assessments"."id", "questionnaire_questions"."id", "assessments"."stressLevel"::TEXT
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'stressLevel'
WHERE "assessments"."stressLevel" IS NOT NULL;

INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText")
SELECT "assessments"."id" || ':mainBarrier', "assessments"."id", "questionnaire_questions"."id", "assessments"."mainBarrier"::TEXT
FROM "assessments"
JOIN "questionnaire_questions" ON "questionnaire_questions"."key" = 'mainBarrier'
WHERE "assessments"."mainBarrier" IS NOT NULL;

ALTER TABLE "assessments"
DROP COLUMN "pacePreference",
DROP COLUMN "workoutDaysPerWeek",
DROP COLUMN "sessionMinutes",
DROP COLUMN "workoutLocation",
DROP COLUMN "dietPreference",
DROP COLUMN "sleepHours",
DROP COLUMN "stressLevel",
DROP COLUMN "mainBarrier";

DROP TYPE "PacePreference";
DROP TYPE "WorkoutLocation";
DROP TYPE "DietPreference";
DROP TYPE "StressLevel";
DROP TYPE "MainBarrier";

ALTER TABLE public.questionnaire_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_answers ENABLE ROW LEVEL SECURITY;
