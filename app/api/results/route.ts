import { handleRouteError, jsonResponse } from "@/lib/api";
import { mapAnswerRows } from "@/lib/assessment-answers";
import { notFound } from "@/lib/errors";
import { buildPlan, buildPlanPreview } from "@/lib/plan";
import { prisma } from "@/lib/prisma";
import { sessionRequestSchema } from "@/lib/validation";

const lockedFields = ["recommendedCalories", "targetDate"] as const;
const lockedSections = ["weeklyWorkoutPlan", "nutritionPlan", "recoveryPlan", "dailyActions"] as const;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { sessionId } = sessionRequestSchema.parse({
      sessionId: searchParams.get("sessionId") ?? "",
    });

    const user = await prisma.user.findUnique({
      where: { id: sessionId },
      include: {
        assessment: {
          include: { answers: { include: { question: true } } },
        },
        result: true,
      },
    });

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
        { status: 409 },
      );
    }

    const extendedAnswers = user.assessment ? mapAnswerRows(user.assessment.answers) : {};
    const plan = buildPlan({
      goal: user.assessment?.goal,
      activityLevel: user.assessment?.activityLevel,
      ...extendedAnswers,
    });

    if (user.subscriptionStatus === "active") {
      // 会员结果返回完整字段；非会员路径绝不复用这个对象，避免误带保护字段。
      return jsonResponse({
        sessionId,
        subscriptionStatus: user.subscriptionStatus,
        needPaywall: false,
        result: {
          bmi: user.result.bmi,
          bmiCategory: user.result.bmiCategory,
          recommendedCalories: user.result.recommendedCalories,
          targetDate: user.result.targetDate.toISOString(),
          plan,
        },
      });
    }

    return jsonResponse({
      sessionId,
      subscriptionStatus: user.subscriptionStatus,
      needPaywall: true,
      result: {
        bmi: user.result.bmi,
        bmiCategory: user.result.bmiCategory,
        recommendedCaloriesRange: calorieRange(user.result.recommendedCalories),
        planPreview: buildPlanPreview(plan),
      },
      lockedFields,
      lockedSections,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function calorieRange(recommendedCalories: number) {
  // 固定档位避免用户通过区间中点反推出精确 recommendedCalories。
  if (recommendedCalories < 1500) return "<1500";
  if (recommendedCalories < 1800) return "1500-1800";
  if (recommendedCalories < 2100) return "1800-2100";
  return ">2100";
}
