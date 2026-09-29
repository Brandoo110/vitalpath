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

    await expect(
      prisma.assessment.create({
        data: { userId: user.id, version: -1 },
      }),
    ).rejects.toThrow();
  });

  it("requires_exactly_one_answer_value_column", async () => {
    const user = await createUser();
    const assessment = await prisma.assessment.create({ data: { userId: user.id } });
    const question = await prisma.questionnaireQuestion.findUniqueOrThrow({
      where: { key: "pacePreference" },
    });

    await expect(
      prisma.assessmentAnswer.create({
        data: {
          assessmentId: assessment.id,
          questionId: question.id,
          valueText: "standard",
          valueNumber: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("requires_plan_and_paid_at_for_active_subscription", async () => {
    const user = await createUser();

    await expect(
      prisma.subscription.update({
        where: { userId: user.id },
        data: { status: "active", plan: null, paidAt: null },
      }),
    ).rejects.toThrow();
  });
});

async function createUser() {
  const user = await prisma.user.create({
    data: { subscription: { create: { status: "free" } } },
  });
  createdUserIds.add(user.id);
  return user;
}
