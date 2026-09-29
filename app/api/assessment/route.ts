import { jsonResponse, handleRouteError, readJson } from "@/lib/api";
import { mapAnswerRows, splitAssessmentData, upsertAssessmentAnswers } from "@/lib/assessment-answers";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { patchAssessmentSchema, sessionRequestSchema } from "@/lib/validation";

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
      },
    });

    if (!user) {
      throw notFound("Session not found");
    }

    // 新用户还没有填写任何步骤时，返回空进度，前端可以从第 0 步开始。
    if (!user.assessment) {
      return jsonResponse({
        sessionId,
        healthDataConsent: user.healthDataConsent,
        assessment: null,
        step: 0,
        completed: false,
        version: 0,
      });
    }

    const { assessment } = user;
    const extendedAnswers = mapAnswerRows(assessment.answers);
    return jsonResponse({
      sessionId,
      healthDataConsent: user.healthDataConsent,
      assessment: {
        gender: assessment.gender,
        goal: assessment.goal,
        age: assessment.age,
        heightCm: assessment.heightCm,
        weightKg: assessment.weightKg,
        targetWeightKg: assessment.targetWeightKg,
        activityLevel: assessment.activityLevel,
        ...extendedAnswers,
      },
      step: assessment.step,
      completed: assessment.completed,
      version: assessment.version,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = patchAssessmentSchema.parse(await readJson(request));

    const user = await prisma.user.findUnique({
      where: { id: input.sessionId },
      include: { assessment: true },
    });

    if (!user) {
      throw notFound("Session not found");
    }

    const currentVersion = user.assessment?.version ?? 0;
    if (input.version !== undefined && input.version !== currentVersion) {
      // 客户端带 version 时启用乐观并发，防止旧请求覆盖新数据。
      throw conflict("version_conflict", "Assessment version is stale", {
        expectedVersion: currentVersion,
        receivedVersion: input.version,
      });
    }

    const { healthDataConsent, ...assessmentData } = input.data;
    const { coreData, extendedAnswers } = splitAssessmentData(assessmentData);
    const updateData = stripUndefined(coreData);
    // 乱序请求不能把进度往回写。
    const nextStep = Math.max(user.assessment?.step ?? 0, input.step);

    const assessment = await prisma.$transaction(async (tx) => {
      if (healthDataConsent !== undefined) {
        await tx.user.update({
          where: { id: input.sessionId },
          data: { healthDataConsent },
        });
      }

      // 第一次保存时创建 assessment，之后每步只增量更新同一条记录。
      const savedAssessment = user.assessment
        ? await tx.assessment.update({
            where: { userId: input.sessionId },
            data: {
              ...updateData,
              step: nextStep,
              version: { increment: 1 },
            },
          })
        : await tx.assessment.create({
            data: {
              userId: input.sessionId,
              ...updateData,
              step: nextStep,
              version: 1,
            },
          });

      await upsertAssessmentAnswers(tx, savedAssessment.id, extendedAnswers);

      return savedAssessment;
    });

    return jsonResponse({
      ok: true,
      step: assessment.step,
      version: assessment.version,
      completed: assessment.completed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}
