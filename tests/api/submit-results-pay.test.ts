import { afterEach, describe, expect, it } from "vitest";

import { PATCH as patchAssessment } from "@/app/api/assessment/route";
import { POST as submitAssessment } from "@/app/api/assessment/submit/route";
import { GET as getResults } from "@/app/api/results/route";
import { POST as pay } from "@/app/api/pay/route";
import { POST as createSession } from "@/app/api/sessions/route";
import { prisma } from "@/lib/prisma";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  // Phase 3 测试会真实写入用户、测评、结果和订阅，结束后按 session 清理。
  for (const sessionId of createdSessionIds) {
    await prisma.user.deleteMany({ where: { id: sessionId } });
  }
  createdSessionIds.clear();
});

describe("submit, results and pay API", () => {
  const unknownSessionId = "22222222-2222-4222-8222-222222222222";

  it("requires_version_for_submit", async () => {
    const sessionId = await createSessionId();

    const response = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
  });

  it("rejects_missing_required_health_fields", async () => {
    const sessionId = await createSessionId();
    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        version: 0,
        data: {
          gender: "female",
          goal: "lose_weight",
        },
      }),
    );

    const response = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("assessment_incomplete");
    expect(body.missingFields).toEqual([
      "age",
      "heightCm",
      "weightKg",
      "targetWeightKg",
      "activityLevel",
    ]);

    const resultCount = await prisma.result.count({ where: { userId: sessionId } });
    expect(resultCount).toBe(0);
  });

  it("creates_result_for_complete_assessment", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);

    const response = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, resultId: expect.any(String) });

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    const result = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.completed).toBe(true);
    expect(result.bmi).toBe(26.4);
    expect(result.bmiCategory).toBe("overweight");
    expect(result.recommendedCalories).toBe(1467);
    expect(result.targetDate.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns_the_same_result_for_repeat_submit_at_the_same_version", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);

    const firstResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );
    const firstBody = await firstResponse.json();
    const firstResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });

    const secondResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.resultId).toBe(firstBody.resultId);
    const secondResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(secondResult.calculatedAt.getTime()).toBe(firstResult.calculatedAt.getTime());
    expect(secondResult.targetDate.getTime()).toBe(firstResult.targetDate.getTime());
  });

  it("invalidates_a_result_after_a_new_assessment_version", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    await submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }));

    const patchResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 5,
        version: 1,
        data: { weightKg: 70 },
      }),
    );
    expect(patchResponse.status).toBe(200);

    const resultResponse = await getResults(
      new Request(`http://localhost/api/results?sessionId=${sessionId}`),
    );
    const resultBody = await resultResponse.json();
    expect(resultResponse.status).toBe(409);
    expect(resultBody.error).toBe("assessment_stale");

    const staleSubmitResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );
    expect(staleSubmitResponse.status).toBe(409);
    expect((await staleSubmitResponse.json()).error).toBe("version_conflict");

    const freshSubmitResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 2 }),
    );
    expect(freshSubmitResponse.status).toBe(200);
    const result = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(result.bmi).toBe(25.7);
  });

  it("serializes_submit_and_patch_on_the_same_assessment_row", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);

    const [submitResponse, patchResponse] = await Promise.all([
      submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 })),
      patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 5,
          version: 1,
          data: { weightKg: 70 },
        }),
      ),
    ]);

    expect(patchResponse.status).toBe(200);
    expect([200, 409]).toContain(submitResponse.status);
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    const result = await prisma.result.findUnique({ where: { userId: sessionId } });
    if (assessment.version === 1) {
      expect(submitResponse.status).toBe(200);
      expect(assessment.completed).toBe(true);
      expect(result?.sourceAssessmentVersion).toBe(1);
    } else {
      expect(assessment.version).toBe(2);
      expect(assessment.completed).toBe(false);
      if (result) {
        expect(result.sourceAssessmentVersion).toBe(1);
        expect(submitResponse.status).toBe(200);
      } else {
        expect(submitResponse.status).toBe(409);
      }
    }
  });

  it("returns_assessment_not_submitted_before_result_exists", async () => {
    const sessionId = await createSessionId();

    const response = await getResults(
      new Request(`http://localhost/api/results?sessionId=${sessionId}`),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "assessment_not_submitted",
      nextAction: "continue_assessment",
    });
  });

  it("free_result_response_omits_all_protected_keys", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    await submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }));

    const response = await getResults(
      new Request(`http://localhost/api/results?sessionId=${sessionId}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscriptionStatus).toBe("free");
    expect(body.needPaywall).toBe(true);
    expect(body.result).toMatchObject({
      bmi: 26.4,
      bmiCategory: "overweight",
      recommendedCaloriesRange: "<1500",
      planPreview: [
        {
          id: "workout",
          title: "Workout plan",
          preview: expect.stringContaining("4 home"),
        },
        {
          id: "nutrition",
          title: "Nutrition plan",
          preview: expect.stringContaining("high-protein"),
        },
        {
          id: "recovery",
          title: "Recovery plan",
          preview: expect.stringContaining("6.5 hours"),
        },
        {
          id: "daily_actions",
          title: "Daily actions",
          preview: expect.stringContaining("time"),
        },
      ],
    });
    expect(body.result).not.toHaveProperty("recommendedCalories");
    expect(body.result).not.toHaveProperty("targetDate");
    expect(body.result).not.toHaveProperty("plan");
    expect(body.lockedFields).toEqual(["recommendedCalories", "targetDate"]);
    expect(body.lockedSections).toEqual([
      "weeklyWorkoutPlan",
      "nutritionPlan",
      "recoveryPlan",
      "dailyActions",
    ]);
  });

  it("unlocks_full_result_after_pay_for_same_session", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    await submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }));

    const beforePayResponse = await getResults(
      new Request(`http://localhost/api/results?sessionId=${sessionId}`),
    );
    const beforePayBody = await beforePayResponse.json();
    expect(beforePayBody.result).not.toHaveProperty("recommendedCalories");

    const payResponse = await pay(jsonRequest("POST", "/api/pay", { sessionId, plan: "monthly" }));
    const payBody = await payResponse.json();
    expect(payResponse.status).toBe(200);
    expect(payBody).toMatchObject({
      ok: true,
      subscriptionStatus: "active",
      paidAt: expect.any(String),
    });

    const afterPayResponse = await getResults(
      new Request(`http://localhost/api/results?sessionId=${sessionId}`),
    );
    const afterPayBody = await afterPayResponse.json();

    expect(afterPayResponse.status).toBe(200);
    expect(afterPayBody.needPaywall).toBe(false);
    expect(afterPayBody.result).toMatchObject({
      bmi: 26.4,
      bmiCategory: "overweight",
      recommendedCalories: 1467,
      targetDate: expect.any(String),
      plan: {
        summary: {
          pacePreference: "standard",
          workoutDaysPerWeek: 4,
          sessionMinutes: 30,
          workoutLocation: "home",
          dietPreference: "high_protein",
        },
        sections: expect.any(Array),
      },
    });
    expect(afterPayBody.result.plan.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "workout",
          items: expect.arrayContaining([expect.stringContaining("4 home")]),
        }),
      ]),
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: sessionId },
      include: { subscription: true },
    });
    expect(user.subscription?.status).toBe("active");
  });

  it("keeps_pay_idempotent_for_active_session", async () => {
    const sessionId = await createSessionId();

    const firstResponse = await pay(jsonRequest("POST", "/api/pay", { sessionId }));
    const secondResponse = await pay(jsonRequest("POST", "/api/pay", { sessionId }));
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.subscriptionStatus).toBe("active");

    const subscriptions = await prisma.subscription.findMany({ where: { userId: sessionId } });
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].status).toBe("active");
  });

  it("rejects_a_different_plan_for_an_active_subscription", async () => {
    const sessionId = await createSessionId();

    const firstResponse = await pay(
      jsonRequest("POST", "/api/pay", { sessionId, plan: "monthly" }),
    );
    const firstBody = await firstResponse.json();
    const conflictResponse = await pay(
      jsonRequest("POST", "/api/pay", { sessionId, plan: "quarterly" }),
    );
    const conflictBody = await conflictResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(conflictResponse.status).toBe(409);
    expect(conflictBody.error).toBe("plan_conflict");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(subscription.plan).toBe("monthly");
    expect(subscription.paidAt?.toISOString()).toBe(firstBody.paidAt);
  });

  it("serializes_competing_first_payments_without_overwriting_the_winner", async () => {
    const sessionId = await createSessionId();
    const responses = await Promise.all([
      pay(jsonRequest("POST", "/api/pay", { sessionId, plan: "monthly" })),
      pay(jsonRequest("POST", "/api/pay", { sessionId, plan: "quarterly" })),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(bodies.filter((body) => body.error === "plan_conflict")).toHaveLength(1);
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(subscription.status).toBe("active");
    expect(["monthly", "quarterly"]).toContain(subscription.plan);
    expect(subscription.paidAt).toBeInstanceOf(Date);
  });

  it("returns_404_for_unknown_pay_uuid_session", async () => {
    const response = await pay(jsonRequest("POST", "/api/pay", { sessionId: unknownSessionId }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
  });

  it("rejects_malformed_pay_session_id_before_database_lookup", async () => {
    const response = await pay(jsonRequest("POST", "/api/pay", { sessionId: "missing-session" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain("sessionId");
  });
});

async function createSessionId() {
  const response = await createSession(jsonRequest("POST", "/api/sessions", {}));
  const body = await response.json();
  createdSessionIds.add(body.sessionId);
  return body.sessionId as string;
}

async function saveCompleteAssessment(sessionId: string) {
  await patchAssessment(
    jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 5,
        version: 0,
        data: {
        gender: "female",
        goal: "lose_weight",
        age: 32,
        heightCm: 165,
        weightKg: 72,
        targetWeightKg: 62,
        activityLevel: "light",
        pacePreference: "standard",
        workoutDaysPerWeek: 4,
        sessionMinutes: 30,
        workoutLocation: "home",
        dietPreference: "high_protein",
        sleepHours: 6.5,
        stressLevel: "medium",
        mainBarrier: "no_time",
        healthDataConsent: true,
      },
    }),
  );
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
