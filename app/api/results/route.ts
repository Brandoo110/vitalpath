import { Prisma } from "@/app/generated/prisma/client";
import { handleRouteError, jsonResponse } from "@/lib/api";
import { mapAnswerRows } from "@/lib/assessment-answers";
import { notFound } from "@/lib/errors";
import { buildPlan, buildPlanPreview } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { sessionRequestSchema } from "@/lib/validation";

const lockedFields = ["recommendedCalories", "targetDate"] as const;
const lockedSections = ["weeklyWorkoutPlan", "nutritionPlan", "recoveryPlan", "dailyActions"] as const;
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { sessionId } = sessionRequestSchema.parse({
      sessionId: searchParams.get("sessionId") ?? "",
    });

    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.user.findUnique({
        where: { id: sessionId },
        include: {
          assessment: {
            include: { answers: { include: { question: true } } },
          },
          result: true,
          subscription: true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    if (!user) {
      throw notFound("Session not found");
    }

    if (!user.result) {
      return jsonResponse(
        {
          error: "assessment_not_submitted",
          message: "Submit assessment before requesting results",
          nextAction: "continue_assessment",
        },
        { status: 409, headers: noStoreHeaders },
      );
    }

    if (!user.assessment) {
      return jsonResponse(
        {
          error: "assessment_not_submitted",
          message: "Submit assessment before requesting results",
          nextAction: "continue_assessment",
        },
        { status: 409, headers: noStoreHeaders },
      );
    }

    if (
      !user.assessment.completed ||
      user.result.assessmentId !== user.assessment.id ||
      user.result.sourceAssessmentVersion === null ||
      user.result.sourceAssessmentVersion !== user.assessment.version
    ) {
      return jsonResponse(
        {
          error: "assessment_stale",
          message: "Assessment changed after the report was generated",
          nextAction: "submit_assessment",
        },
        { status: 409, headers: noStoreHeaders },
      );
    }

    const extendedAnswers = user.assessment ? mapAnswerRows(user.assessment.answers) : {};
    const plan = buildPlan({
      goal: user.assessment?.goal,
      activityLevel: user.assessment?.activityLevel,
      ...extendedAnswers,
    });

    const subscriptionStatus = user.subscription?.status ?? "free";

    if (subscriptionStatus === "active") {
      // 会员结果返回完整字段；非会员路径绝不复用这个对象，避免误带保护字段。
      return jsonResponse({
        sessionId,
        subscriptionStatus,
        needPaywall: false,
        result: {
          bmi: user.result.bmi,
          bmiCategory: user.result.bmiCategory,
          recommendedCalories: user.result.recommendedCalories,
          targetDate: user.result.targetDate.toISOString(),
          plan,
        },
      }, { headers: noStoreHeaders });
    }

    return jsonResponse({
      sessionId,
      subscriptionStatus,
      needPaywall: true,
      result: {
        bmi: user.result.bmi,
        bmiCategory: user.result.bmiCategory,
        recommendedCaloriesRange: calorieRange(user.result.recommendedCalories),
        planPreview: buildPlanPreview(plan),
      },
      lockedFields,
      lockedSections,
    }, { headers: noStoreHeaders });
  } catch (error) {
    const response = handleRouteError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

function calorieRange(recommendedCalories: number) {
  // 固定档位避免用户通过区间中点反推出精确 recommendedCalories。
  if (recommendedCalories < 1500) return "<1500";
  if (recommendedCalories < 1800) return "1500-1800";
  if (recommendedCalories < 2100) return "1800-2100";
  return ">2100";
}
