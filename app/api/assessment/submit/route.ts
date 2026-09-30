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
        return {
          kind: "incomplete" as const,
          missingFields: [...requiredHealthFields],
          nextStep: 0,
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
        };
      }
      if (user.healthDataConsent !== true) {
        throw unprocessable(
          "assessment_invalid",
          "Health data consent is required before submitting",
          {
            field: "healthDataConsent",
            issues: [{ field: "healthDataConsent", message: "Health data consent is required before submitting" }],
            nextStep: 9,
            nextAction: "continue_assessment",
          },
        );
      }
      if (assessment.wellnessEligible !== true) {
        throw unprocessable(
          "assessment_invalid",
          "Confirm that this estimate is appropriate before submitting",
          {
            field: "wellnessEligible",
            issues: [{ field: "wellnessEligible", message: "Confirm this estimate applies to you before submitting" }],
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
          nextStep: 9,
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
          issues: result.missingFields.map((field) => ({ field, message: "This field is required" })),
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
  return fields.find((field) => message.includes(field)) ?? "assessment";
}
