import { Prisma } from "@/app/generated/prisma/client";
import { jsonResponse, handleRouteError, readJson } from "@/lib/api";
import { mapAnswerRows, splitAssessmentData, upsertAssessmentAnswers } from "@/lib/assessment-answers";
import { lockAssessment, lockUser } from "@/lib/assessment-service";
import { deriveAssessmentProgress } from "@/lib/assessment-progress";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { patchAssessmentSchema, sessionRequestSchema } from "@/lib/validation";

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
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    if (!user) {
      throw notFound("Session not found");
    }

    // 新用户还没有填写任何步骤时，返回空进度，前端可以从第 0 步开始。
    if (!user.assessment) {
      const progress = deriveAssessmentProgress(null, user.healthDataConsent, user.result);
      return jsonResponse({
        sessionId,
        healthDataConsent: user.healthDataConsent,
        assessment: null,
        step: 0,
        completed: false,
        version: 0,
        ...progress,
      }, { headers: noStoreHeaders });
    }

    const { assessment } = user;
    const progress = deriveAssessmentProgress(assessment, user.healthDataConsent, user.result);
    let extendedAnswers;
    try {
      extendedAnswers = mapAnswerRows(assessment.answers);
    } catch (error) {
      throw unprocessable("assessment_invalid", errorMessage(error));
    }
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
      ...progress,
    }, { headers: noStoreHeaders });
  } catch (error) {
    const response = handleRouteError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Assessment data is invalid";
}

export async function PATCH(request: Request) {
  try {
    const input = patchAssessmentSchema.parse(await readJson(request));

    const { healthDataConsent, ...assessmentData } = input.data;
    const { coreData, extendedAnswers } = splitAssessmentData(assessmentData);
    const updateData = stripUndefined(coreData);

    const snapshot = await prisma.$transaction(async (tx) => {
      // The user is the aggregate root: lock it before looking up the
      // optional one-per-user assessment, including on the first save.
      await lockUser(tx, input.sessionId);
      await lockAssessment(tx, input.sessionId);

      const user = await tx.user.findUnique({
        where: { id: input.sessionId },
        include: {
          assessment: { include: { answers: { include: { question: true } } } },
          result: true,
        },
      });
      if (!user) throw notFound("Session not found");
      const current = user.assessment;
      const currentVersion = current?.version ?? 0;
      if (input.version !== currentVersion) {
        throw conflict("version_conflict", "Assessment version is stale", {
          expectedVersion: currentVersion,
          receivedVersion: input.version,
        });
      }

      const currentAnswers = current ? mapAnswerRows(current.answers) : {};
      const coreChanged = Object.entries(updateData).some(([key, value]) => current?.[key as keyof typeof current] !== value);
      const extendedChanged = Object.entries(extendedAnswers).some(([key, value]) => currentAnswers[key as keyof typeof currentAnswers] !== value);
      const consentChanged = healthDataConsent !== undefined && healthDataConsent !== user.healthDataConsent;
      const hasAssessmentData = Object.keys(updateData).length > 0 || Object.keys(extendedAnswers).length > 0;

      if (consentChanged) {
        await tx.user.update({ where: { id: input.sessionId }, data: { healthDataConsent } });
      }

      let savedAssessment = current;
      if (!current && hasAssessmentData) {
        savedAssessment = await tx.assessment.create({
          data: { userId: input.sessionId, ...updateData, step: input.step, version: 1 },
          include: { answers: { include: { question: true } } },
        });
        await upsertAssessmentAnswers(tx, savedAssessment.id, extendedAnswers);
      } else if (current && (coreChanged || extendedChanged || consentChanged)) {
        await updateExistingAssessment(tx, current.id, current.version, {
          ...updateData,
          step: Math.max(current.step, input.step),
          completed: false,
        });
        await upsertAssessmentAnswers(tx, current.id, extendedAnswers);
      } else if (current && input.step > current.step) {
        savedAssessment = await tx.assessment.update({
          where: { id: current.id },
          data: { step: input.step },
          include: { answers: { include: { question: true } } },
        });
      }

      const refreshed = await tx.user.findUniqueOrThrow({
        where: { id: input.sessionId },
        include: {
          assessment: { include: { answers: { include: { question: true } } } },
          result: true,
        },
      });
      const progress = deriveAssessmentProgress(
        refreshed.assessment,
        refreshed.healthDataConsent,
        refreshed.result,
      );
      return { assessment: refreshed.assessment, progress };
    });

    return jsonResponse({
      ok: true,
      step: snapshot.assessment?.step ?? 0,
      version: snapshot.assessment?.version ?? 0,
      completed: snapshot.assessment?.completed ?? false,
      ...snapshot.progress,
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
