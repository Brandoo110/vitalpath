import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

const createdUserIds = new Set<string>();

afterEach(async () => {
  for (const userId of createdUserIds) {
    await prisma.user.delete({ where: { id: userId } });
  }
  createdUserIds.clear();
});

describe("database consistency constraints", () => {
  it("rejects_negative_assessment_versions", async () => {
    const user = await createUser();

    await expectConstraintFailure(
      prisma.assessment.create({
        data: { userId: user.id, version: -1 },
      }),
      "23514",
      "assessments_version_nonnegative_check",
    );
  });

  it("requires_exactly_one_answer_value_column", async () => {
    const user = await createUser();
    const assessment = await prisma.assessment.create({ data: { userId: user.id } });
    const question = await prisma.questionnaireQuestion.findUniqueOrThrow({
      where: { key: "pacePreference" },
    });

    await expectConstraintFailure(
      prisma.assessmentAnswer.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          valueText: "standard",
          valueNumber: 1,
        },
      }),
      "23514",
      "assessment_answers_exactly_one_value_check",
    );
  });

  it("requires_plan_and_paid_at_for_active_subscription", async () => {
    const user = await createUser();

    await expectConstraintFailure(
      prisma.subscription.update({
        where: { userId: user.id },
        data: { status: "active", plan: null, paidAt: null },
      }),
      "23514",
      "subscriptions_status_fields_check",
    );
  });

  it("prevents_a_result_from_crossing_user_assessment_ownership", async () => {
    const owner = await createUser();
    const other = await createUser();
    const assessment = await prisma.assessment.create({ data: { userId: other.id } });

    await expectConstraintFailure(
      prisma.result.create({
        data: {
          userId: owner.id,
          assessmentId: assessment.id,
          bmi: 22,
          bmiCategory: "normal",
          recommendedCalories: 1800,
        },
      }),
      "23503",
      "results_assessmentId_userId_fkey",
    );
  });
});

async function expectConstraintFailure(
  operation: Promise<unknown>,
  postgresCode: string,
  constraint: string,
) {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL constraint ${constraint} to reject`);
  } catch (error) {
    const candidate = error as {
      cause?: { originalCode?: string; originalMessage?: string };
      meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } };
    };
    const cause = candidate.meta?.driverAdapterError?.cause ?? candidate.cause;
    expect(cause).toMatchObject({
      originalCode: postgresCode,
      originalMessage: expect.stringContaining(constraint),
    });
  }
}

async function createUser() {
  const user = await prisma.user.create({
    data: { subscription: { create: { status: "free" } } },
  });
  createdUserIds.add(user.id);
  return user;
}
