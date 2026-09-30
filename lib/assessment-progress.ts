import { healthAlgorithmVersion } from "./health";

export const requiredProgressFields = [
  "gender",
  "age",
  "heightCm",
  "weightKg",
  "targetWeightKg",
  "goal",
  "activityLevel",
  "healthDataConsent",
  "wellnessEligible",
] as const;

const progressFieldSteps = [
  { field: "gender", step: 0 },
  { field: "age", step: 1 },
  { field: "heightCm", step: 2 },
  { field: "weightKg", step: 2 },
  { field: "targetWeightKg", step: 2 },
  { field: "goal", step: 3 },
  { field: "activityLevel", step: 5 },
  { field: "healthDataConsent", step: 9 },
  { field: "wellnessEligible", step: 9 },
] as const;

type ProgressAssessment = {
  id: string;
  gender: string | null;
  goal: string | null;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: string | null;
  wellnessEligible: boolean | null;
  completed: boolean;
  version: number;
};

type ProgressResult = {
  assessmentId: string;
  sourceAssessmentVersion: number | null;
  algorithmVersion: string;
} | null;

export type AssessmentProgress = {
  nextStep: number;
  missingFields: string[];
  state: "empty" | "draft" | "completed" | "stale";
};

export function deriveAssessmentProgress(
  assessment: ProgressAssessment | null,
  healthDataConsent: boolean,
  result: ProgressResult,
): AssessmentProgress {
  if (!assessment) {
    return {
      nextStep: 0,
      missingFields: [...requiredProgressFields],
      state: "empty",
    };
  }

  const values: Record<string, unknown> = {
    gender: assessment.gender,
    age: assessment.age,
    heightCm: assessment.heightCm,
    weightKg: assessment.weightKg,
    targetWeightKg: assessment.targetWeightKg,
    goal: assessment.goal,
    activityLevel: assessment.activityLevel,
    healthDataConsent,
    wellnessEligible: assessment.wellnessEligible,
  };
  const missingFields = progressFieldSteps
    .filter(({ field }) => values[field] === null || values[field] === undefined || values[field] === false)
    .map(({ field }) => field);
  const resultIsCurrent = result !== null
    && result.assessmentId === assessment.id
    && result.sourceAssessmentVersion === assessment.version
    && result.algorithmVersion === healthAlgorithmVersion;

  return {
    nextStep: missingFields[0]
      ? progressFieldSteps.find(({ field }) => field === missingFields[0])!.step
      : resultIsCurrent && assessment.completed ? 10 : 9,
    missingFields,
    state: result && !resultIsCurrent
      ? "stale"
      : resultIsCurrent && assessment.completed
        ? "completed"
        : "draft",
  };
}
