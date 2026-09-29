import { Prisma } from "@/app/generated/prisma/client";
import { jsonResponse, handleRouteError, readJson } from "@/lib/api";
import { mapAnswerRows, splitAssessmentData, upsertAssessmentAnswers } from "@/lib/assessment-answers";
import { lockAssessment, lockUser } from "@/lib/assessment-service";
import { conflict, notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { patchAssessmentSchema, sessionRequestSchema } from "@/lib/validation";

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
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

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
        wellnessEligible: assessment.wellnessEligible,
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

    const { healthDataConsent, ...assessmentData } = input.data;
    const { coreData, extendedAnswers } = splitAssessmentData(assessmentData);
    const updateData = stripUndefined(coreData);

    const assessment = await prisma.$transaction(async (tx) => {
      // The user is the aggregate root: lock it before looking up the
      // optional one-per-user assessment, including on the first save.
      await lockUser(tx, input.sessionId);
      await lockAssessment(tx, input.sessionId);

      const current = await tx.assessment.findUnique({ where: { userId: input.sessionId } });
      const currentVersion = current?.version ?? 0;
      if (input.version !== currentVersion) {
        throw conflict("version_conflict", "Assessment version is stale", {
          expectedVersion: currentVersion,
          receivedVersion: input.version,
        });
      }

      if (healthDataConsent !== undefined) {
        await tx.user.update({
          where: { id: input.sessionId },
          data: { healthDataConsent },
        });
      }

      // 第一次保存时创建 assessment，之后每步只增量更新同一条记录。
      const savedAssessment = current
        ? await updateExistingAssessment(tx, current.id, current.version, {
            ...updateData,
            // 乱序请求不能把进度往回写。
            step: Math.max(current.step, input.step),
            completed: false,
          })
        : await tx.assessment.create({
            data: {
              userId: input.sessionId,
              ...updateData,
              step: input.step,
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

async function updateExistingAssessment(
  tx: Parameters<typeof upsertAssessmentAnswers>[0],
  assessmentId: string,
  expectedVersion: number,
  data: Record<string, unknown>,
) {
  const update = await tx.assessment.updateMany({
    where: { id: assessmentId, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });
  if (update.count !== 1) {
    throw conflict("version_conflict", "Assessment version is stale", {
      expectedVersion,
      receivedVersion: expectedVersion,
    });
  }
  return tx.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}
