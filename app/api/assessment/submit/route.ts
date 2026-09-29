import type { Assessment } from "@/app/generated/prisma/client";
import { mapAnswerRows, type ExtendedAssessmentAnswers } from "@/lib/assessment-answers";
import { handleRouteError, jsonResponse, readJson } from "@/lib/api";
import { calculateHealthResult, type HealthInput } from "@/lib/health";
import { notFound, unprocessable } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { sessionRequestSchema } from "@/lib/validation";

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
    const { sessionId } = sessionRequestSchema.parse(await readJson(request));

    const user = await prisma.user.findUnique({
      where: { id: sessionId },
      include: {
        assessment: {
          include: { answers: { include: { question: true } } },
        },
      },
    });

    if (!user) {
      throw notFound("Session not found");
    }

    const missingFields = collectMissingFields(user.assessment);
    if (missingFields.length > 0) {
      // 缺字段时不生成 result，避免把半成品测评误认为可展示结果。
      return jsonResponse(
        {
          error: "assessment_incomplete",
          message: "Assessment is missing required health fields",
          missingFields,
        },
        { status: 422 },
      );
    }

    let resultInput: HealthInput;
    let calculatedResult: ReturnType<typeof calculateHealthResult>;
    try {
      const extendedAnswers = user.assessment ? mapAnswerRows(user.assessment.answers) : {};
      resultInput = toHealthInput(user.assessment, extendedAnswers);
      calculatedResult = calculateHealthResult(resultInput);
    } catch (error) {
      throw unprocessable("assessment_invalid", errorMessage(error));
    }

    const result = await prisma.$transaction(async (tx) => {
      const upsertedResult = await tx.result.upsert({
        where: { userId: sessionId },
        create: {
          userId: sessionId,
          bmi: calculatedResult.bmi,
          bmiCategory: calculatedResult.bmiCategory,
          recommendedCalories: calculatedResult.recommendedCalories,
          targetDate: calculatedResult.targetDate,
        },
        update: {
          bmi: calculatedResult.bmi,
          bmiCategory: calculatedResult.bmiCategory,
          recommendedCalories: calculatedResult.recommendedCalories,
          targetDate: calculatedResult.targetDate,
        },
      });

      await tx.assessment.update({
        where: { userId: sessionId },
        data: { completed: true },
      });

      return upsertedResult;
    });

    return jsonResponse({
      ok: true,
      resultId: result.id,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function collectMissingFields(assessment: Assessment | null) {
  if (!assessment) {
    return [...requiredHealthFields];
  }

  return requiredHealthFields.filter((field) => assessment[field] === null);
}

function toHealthInput(
  assessment: Assessment | null,
  extendedAnswers: ExtendedAssessmentAnswers,
): HealthInput {
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  return {
    gender: assessment.gender as HealthInput["gender"],
    goal: assessment.goal as HealthInput["goal"],
    age: assessment.age as number,
    heightCm: assessment.heightCm as number,
    weightKg: assessment.weightKg as number,
    targetWeightKg: assessment.targetWeightKg as number,
    activityLevel: assessment.activityLevel as HealthInput["activityLevel"],
    pacePreference: extendedAnswers.pacePreference,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Assessment data is invalid";
}
