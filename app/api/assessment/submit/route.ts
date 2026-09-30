import type { Assessment } from "@/app/generated/prisma/client";
import { mapAnswerRows, type ExtendedAssessmentAnswers } from "@/lib/assessment-answers";
import { handleRouteError, jsonResponse, readJson } from "@/lib/api";
import { assessmentWithAnswers, lockAssessment, lockUser } from "@/lib/assessment-service";
import { deriveAssessmentProgress } from "@/lib/assessment-progress";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { calculateHealthResult, healthAlgorithmVersion, type HealthInput } from "@/lib/health";
import { prisma } from "@/lib/prisma";
import { submitAssessmentSchema } from "@/lib/validation";

const requiredHealthFields = [
  "gender",
  "goal",
  "age",
  "heightCm",
  "weightKg",
  "targetWeightKg",
  "activityLevel",
] as const;

export async function POST(request: Request) {
  try {
    const input = submitAssessmentSchema.parse(await readJson(request));

    const result = await prisma.$transaction(async (tx) => {
      await lockUser(tx, input.sessionId);
      await lockAssessment(tx, input.sessionId);
      const user = await tx.user.findUnique({
        where: { id: input.sessionId },
        include: {
          assessment: { include: assessmentWithAnswers },
          result: true,
        },
      });

      if (!user) throw notFound("Session not found");

      const assessment = user.assessment;
      if (!assessment) {
        const progress = deriveAssessmentProgress(null, user.healthDataConsent, user.result);
        return {
          kind: "incomplete" as const,
          missingFields: [...requiredHealthFields],
          nextStep: 0,
          issues: progress.missingFields.map((field) => ({ field, message: "This field is required" })),
        };
      }
      if (input.version !== assessment.version) {
        throw conflict("version_conflict", "Assessment version is stale", {
          expectedVersion: assessment.version,
          receivedVersion: input.version,
        });
      }

      const progress = deriveAssessmentProgress(assessment, user.healthDataConsent, user.result);
      const missingFields = collectMissingFields(assessment);
      if (missingFields.length > 0) {
        return {
          kind: "incomplete" as const,
          missingFields,
          nextStep: progress.nextStep,
          issues: progress.missingFields.map((field) => ({ field, message: "This field is required" })),
        };
      }
      const missingConfirmationFields = progress.missingFields.filter(
        (field) => field === "healthDataConsent" || field === "wellnessEligible",
      );
      if (missingConfirmationFields.length > 0) {
        const confirmationIssues = missingConfirmationFields.map((field) => ({
          field,
          message: field === "healthDataConsent"
            ? "Health data consent is required before submitting"
            : "Confirm this estimate applies to you before submitting",
        }));
        throw unprocessable(
          "assessment_invalid",
          confirmationIssues[0].message,
          {
            field: confirmationIssues[0].field,
            issues: confirmationIssues,
            nextStep: 9,
            nextAction: "continue_assessment",
          },
        );
      }

      let extendedAnswers: ExtendedAssessmentAnswers;
      try {
        extendedAnswers = mapAnswerRows(assessment.answers);
      } catch (error) {
        throw unprocessable("assessment_invalid", errorMessage(error));
      }

      if (
        assessment.completed &&
        user.result?.assessmentId === assessment.id &&
        user.result.sourceAssessmentVersion === assessment.version &&
        user.result.algorithmVersion === healthAlgorithmVersion
      ) {
        return { kind: "result" as const, resultId: user.result.id };
      }

      let calculatedResult: ReturnType<typeof calculateHealthResult>;
      const calculatedAt = new Date();
      try {
        const resultInput = toHealthInput(assessment, extendedAnswers, calculatedAt);
        calculatedResult = calculateHealthResult(resultInput);
      } catch (error) {
        const message = errorMessage(error);
        const field = healthInputField(message);
        throw unprocessable("assessment_invalid", message, {
          issues: [{ field, message }],
          nextStep: healthInputStep(field),
          nextAction: "review_assessment",
        });
      }

      const savedResult = await tx.result.upsert({
        where: { userId: input.sessionId },
        create: {
          userId: input.sessionId,
          assessmentId: assessment.id,
          sourceAssessmentVersion: assessment.version,
          bmi: calculatedResult.bmi,
          bmiCategory: calculatedResult.bmiCategory,
          recommendedCalories: calculatedResult.recommendedCalories,
          targetDate: calculatedResult.targetDate,
          calculationDetails: calculatedResult.calculationDetails,
          calculatedAt,
          algorithmVersion: healthAlgorithmVersion,
        },
        update: {
          assessmentId: assessment.id,
          sourceAssessmentVersion: assessment.version,
          bmi: calculatedResult.bmi,
          bmiCategory: calculatedResult.bmiCategory,
          recommendedCalories: calculatedResult.recommendedCalories,
          targetDate: calculatedResult.targetDate,
          calculationDetails: calculatedResult.calculationDetails,
          calculatedAt,
          algorithmVersion: healthAlgorithmVersion,
        },
      });

      await tx.assessment.update({
        where: { id: assessment.id },
        data: { completed: true },
      });

      return { kind: "result" as const, resultId: savedResult.id };
    });

    if (result.kind === "incomplete") {
      return jsonResponse(
        {
          error: "assessment_incomplete",
          message: "Assessment is missing required health fields",
          missingFields: result.missingFields,
          issues: result.issues,
          nextStep: result.nextStep,
          nextAction: "continue_assessment",
        },
        { status: 422 },
      );
    }

    return jsonResponse({ ok: true, resultId: result.resultId });
  } catch (error) {
    return handleRouteError(error);
  }
}

function collectMissingFields(assessment: Assessment | null) {
  if (!assessment) return [...requiredHealthFields];
  return requiredHealthFields.filter((field) => assessment[field] === null);
}

function toHealthInput(
  assessment: Assessment & { answers: Parameters<typeof mapAnswerRows>[0] },
  extendedAnswers: ExtendedAssessmentAnswers,
  now: Date,
): HealthInput {
  return {
    gender: assessment.gender as HealthInput["gender"],
    goal: assessment.goal as HealthInput["goal"],
    age: assessment.age as number,
    heightCm: assessment.heightCm as number,
    weightKg: assessment.weightKg as number,
    targetWeightKg: assessment.targetWeightKg as number,
    activityLevel: assessment.activityLevel as HealthInput["activityLevel"],
    pacePreference: extendedAnswers.pacePreference,
    wellnessEligible: assessment.wellnessEligible ?? undefined,
    now,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Assessment data is invalid";
}

function healthInputField(message: string) {
  const fields = ["age", "heightCm", "weightKg", "targetWeightKg", "goal", "activityLevel"];
  const directField = fields.find((field) => message.includes(field));
  if (directField) return directField;
  if (/target BMI/i.test(message)) return "targetWeightKg";
  return "assessment";
}

function healthInputStep(field: string) {
  if (field === "age") return 1;
  if (["heightCm", "weightKg", "targetWeightKg", "assessment"].includes(field)) return 2;
  if (field === "goal") return 3;
  if (field === "activityLevel") return 5;
  return 9;
}
