import type { Assessment } from "@/app/generated/prisma/client";
import { mapAnswerRows, type ExtendedAssessmentAnswers } from "@/lib/assessment-answers";
import { handleRouteError, jsonResponse, readJson } from "@/lib/api";
import { assessmentWithAnswers, lockAssessment } from "@/lib/assessment-service";
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
        return { kind: "incomplete" as const, missingFields: [...requiredHealthFields] };
      }
      if (input.version !== assessment.version) {
        throw conflict("version_conflict", "Assessment version is stale", {
          expectedVersion: assessment.version,
          receivedVersion: input.version,
        });
      }

      const missingFields = collectMissingFields(assessment);
      if (missingFields.length > 0) {
        return { kind: "incomplete" as const, missingFields };
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
        const extendedAnswers = mapAnswerRows(assessment.answers);
        const resultInput = toHealthInput(assessment, extendedAnswers, calculatedAt);
        calculatedResult = calculateHealthResult(resultInput);
      } catch (error) {
        throw unprocessable("assessment_invalid", errorMessage(error));
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
    now,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Assessment data is invalid";
}
