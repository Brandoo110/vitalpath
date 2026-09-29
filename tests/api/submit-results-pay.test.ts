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

  it("rejects_missing_required_health_fields", async () => {
    const sessionId = await createSessionId();
    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        data: {
          gender: "female",
          goal: "lose_weight",
        },
      }),
    );

    const response = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId }),
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
      jsonRequest("POST", "/api/assessment/submit", { sessionId }),
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

  it("updates_existing_result_on_repeat_submit", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);

    const firstResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId }),
    );
    const firstBody = await firstResponse.json();

    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 5,
        data: {
          weightKg: 70,
        },
      }),
    );
    const secondResponse = await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId }),
    );
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.resultId).toBe(firstBody.resultId);

    const results = await prisma.result.findMany({ where: { userId: sessionId } });
    expect(results).toHaveLength(1);
    expect(results[0].bmi).toBe(25.7);
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
    await submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId }));

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
    await submitAssessment(jsonRequest("POST", "/api/assessment/submit", { sessionId }));

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
    expect(user.subscriptionStatus).toBe("active");
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
