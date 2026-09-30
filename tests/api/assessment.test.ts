import { afterEach, describe, expect, it } from "vitest";

import { GET as getAssessment, PATCH as patchAssessment } from "@/app/api/assessment/route";
import { POST as submitAssessment } from "@/app/api/assessment/submit/route";
import { POST as createSession } from "@/app/api/sessions/route";
import { prisma } from "@/lib/prisma";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  // 测试写真实数据库；每个用例结束后清掉本用例创建的匿名用户。
  for (const sessionId of createdSessionIds) {
    await prisma.user.deleteMany({ where: { id: sessionId } });
  }
  createdSessionIds.clear();
});

describe("assessment persistence API", () => {
  const unknownSessionId = "11111111-1111-4111-8111-111111111111";

  it("returns_empty_progress_for_new_session", async () => {
    const sessionId = await createSessionId();

    const response = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${sessionId}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      sessionId,
      healthDataConsent: false,
      assessment: null,
      step: 0,
      completed: false,
      version: 0,
      nextStep: 0,
      missingFields: [
        "gender",
        "age",
        "heightCm",
        "weightKg",
        "targetWeightKg",
        "goal",
        "activityLevel",
        "healthDataConsent",
        "wellnessEligible",
      ],
      state: "empty",
    });
  });

  it("does_not_list_confirmed_health_data_consent_as_missing_on_empty_progress", async () => {
    const response = await createSession(
      jsonRequest("POST", "/api/sessions", { healthDataConsent: true }),
    );
    const body = await response.json();
    createdSessionIds.add(body.sessionId);

    const progress = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${body.sessionId}`),
    );
    const progressBody = await progress.json();
    expect(progressBody.healthDataConsent).toBe(true);
    expect(progressBody.missingFields).not.toContain("healthDataConsent");
  });

  it("derives_next_step_and_missing_fields_from_saved_core_data", async () => {
    const sessionId = await createSessionId();

    const patchResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 4,
        version: 0,
        data: { gender: "female", healthDataConsent: true },
      }),
    );
    const patchBody = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchBody).toMatchObject({
      ok: true,
      step: 4,
      version: 1,
      completed: false,
      nextStep: 1,
      missingFields: [
        "age",
        "heightCm",
        "weightKg",
        "targetWeightKg",
        "goal",
        "activityLevel",
        "wellnessEligible",
      ],
      state: "draft",
    });

    const getResponse = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${sessionId}`),
    );
    expect(await getResponse.json()).toMatchObject({
      nextStep: 1,
      missingFields: expect.arrayContaining(["age", "wellnessEligible"]),
      state: "draft",
    });
  });

  it("does_not_create_an_empty_assessment_for_an_empty_patch", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 8,
        version: 0,
        data: {},
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      step: 0,
      version: 0,
      completed: false,
      nextStep: 0,
      state: "empty",
    });
    expect(await prisma.assessment.findUnique({ where: { userId: sessionId } })).toBeNull();
  });

  it("treats_semantically_identical_data_as_a_noop_but_real_changes_stale_a_report", async () => {
    const sessionId = await createSessionId();
    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 9,
        version: 0,
        data: {
          gender: "female",
          goal: "lose_weight",
          age: 32,
          heightCm: 165,
          weightKg: 72,
          targetWeightKg: 62,
          activityLevel: "light",
          healthDataConsent: true,
          wellnessEligible: true,
        },
      }),
    );
    await submitAssessment(
      jsonRequest("POST", "/api/assessment/submit", { sessionId, version: 1 }),
    );

    const noOp = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 10,
        version: 1,
        data: { gender: "female" },
      }),
    );
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toMatchObject({
      version: 1,
      completed: true,
      state: "completed",
      nextStep: 10,
    });

    const changed = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 10,
        version: 1,
        data: { weightKg: 70 },
      }),
    );
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      version: 2,
      completed: false,
      state: "stale",
      nextStep: 9,
    });
  });

  it("restores_progress_after_partial_patch", async () => {
    const sessionId = await createSessionId();

    const patchResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        version: 0,
        data: {
          gender: "female",
          goal: "lose_weight",
          age: 32,
          healthDataConsent: true,
        },
      }),
    );
    const patchBody = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchBody).toMatchObject({ ok: true, step: 2, version: 1, completed: false });

    const getResponse = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${sessionId}`),
    );
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.healthDataConsent).toBe(true);
    expect(getBody.step).toBe(2);
    expect(getBody.version).toBe(1);
    expect(getBody.assessment).toMatchObject({
      gender: "female",
      goal: "lose_weight",
      age: 32,
    });
  });

  it("deduplicates_repeated_patch_for_same_step", async () => {
    const sessionId = await createSessionId();

    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        version: 0,
        data: { gender: "male" },
      }),
    );
    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        version: 1,
        data: { gender: "male" },
      }),
    );

    const count = await prisma.assessment.count({ where: { userId: sessionId } });
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });

    expect(count).toBe(1);
    expect(assessment.step).toBe(1);
    expect(assessment.version).toBe(1);
  });

  it("does_not_regress_step_on_out_of_order_patch", async () => {
    const sessionId = await createSessionId();

    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 4,
        version: 0,
        data: { goal: "get_toned" },
      }),
    );
    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        version: 1,
        data: { activityLevel: "light" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.step).toBe(4);

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.step).toBe(4);
    expect(assessment.activityLevel).toBe("light");
  });

  it("persists_extended_questionnaire_fields", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 4,
        version: 0,
        data: {
          pacePreference: "standard",
          workoutDaysPerWeek: 4,
          sessionMinutes: 30,
          workoutLocation: "home",
          dietPreference: "high_protein",
          sleepHours: 6.5,
          stressLevel: "medium",
          mainBarrier: "no_time",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, step: 4, version: 1 });

    const getResponse = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${sessionId}`),
    );
    const getBody = await getResponse.json();

    expect(getBody.assessment).toMatchObject({
      pacePreference: "standard",
      workoutDaysPerWeek: 4,
      sessionMinutes: 30,
      workoutLocation: "home",
      dietPreference: "high_protein",
      sleepHours: 6.5,
      stressLevel: "medium",
      mainBarrier: "no_time",
    });

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    const answers = await prisma.assessmentAnswer.findMany({
      where: { assessmentId: assessment.id },
      include: { question: true },
      orderBy: { question: { key: "asc" } },
    });

    expect(answers.map((answer) => answer.question.key)).toEqual([
      "dietPreference",
      "mainBarrier",
      "pacePreference",
      "sessionMinutes",
      "sleepHours",
      "stressLevel",
      "workoutDaysPerWeek",
      "workoutLocation",
    ]);
    expect(
      answers.map((answer) => ({
        key: answer.question.key,
        valueText: answer.valueText,
        valueNumber: answer.valueNumber,
      })),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "workoutDaysPerWeek", valueNumber: 4 }),
        expect.objectContaining({ key: "dietPreference", valueText: "high_protein" }),
      ]),
    );
  });

  it("rejects_stale_concurrent_patch", async () => {
    const sessionId = await createSessionId();

    const firstResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        version: 0,
        data: { age: 31 },
      }),
    );
    const firstBody = await firstResponse.json();
    expect(firstBody.version).toBe(1);

    const clientAVersion = firstBody.version;
    const clientBVersion = firstBody.version;

    const clientAResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        version: clientAVersion,
        data: { heightCm: 170 },
      }),
    );
    const clientABody = await clientAResponse.json();
    expect(clientAResponse.status).toBe(200);
    expect(clientABody.version).toBe(2);

    const clientBResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 3,
        version: clientBVersion,
        data: { weightKg: 80 },
      }),
    );
    const clientBBody = await clientBResponse.json();

    expect(clientBResponse.status).toBe(409);
    expect(clientBBody.error).toBe("version_conflict");

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.heightCm).toBe(170);
    expect(assessment.weightKg).toBeNull();
    expect(assessment.step).toBe(2);
    expect(assessment.version).toBe(2);
  });

  it("requires_version_for_patch", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        data: { age: 31 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
  });

  it("allows_only_one_of_two_concurrent_patches_with_the_same_version", async () => {
    const sessionId = await createSessionId();
    const firstResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        version: 0,
        data: { age: 31 },
      }),
    );
    const firstBody = await firstResponse.json();

    const responses = await Promise.all([
      patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 2,
          version: firstBody.version,
          data: { heightCm: 170 },
        }),
      ),
      patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 3,
          version: firstBody.version,
          data: { weightKg: 80 },
        }),
      ),
    ]);

    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(bodies.filter((body) => body.error === "version_conflict")).toHaveLength(1);

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.version).toBe(2);
    expect(Number(assessment.heightCm) === 170 || Number(assessment.weightKg) === 80).toBe(true);
  });

  it("serializes_competing_first_saves", async () => {
    const sessionId = await createSessionId();
    const responses = await Promise.all([
      patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 1,
          version: 0,
          data: { age: 31 },
        }),
      ),
      patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 2,
          version: 0,
          data: { age: 32 },
        }),
      ),
    ]);

    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(bodies.filter((body) => body.error === "version_conflict")).toHaveLength(1);
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.version).toBe(1);
    expect([31, 32]).toContain(assessment.age);
  });

  it("rolls_back_consent_and_assessment_when_answer_persistence_fails", async () => {
    const sessionId = await createSessionId();
    const question = await prisma.questionnaireQuestion.findUniqueOrThrow({
      where: { key: "pacePreference" },
    });
    await prisma.questionnaireQuestion.update({
      where: { id: question.id },
      data: { active: false },
    });

    try {
      const response = await patchAssessment(
        jsonRequest("PATCH", "/api/assessment", {
          sessionId,
          step: 4,
          version: 0,
          data: { pacePreference: "standard", healthDataConsent: true },
        }),
      );

      expect(response.status).toBe(500);
      expect(await prisma.assessment.findUnique({ where: { userId: sessionId } })).toBeNull();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionId } });
      expect(user.healthDataConsent).toBe(false);
    } finally {
      await prisma.questionnaireQuestion.update({
        where: { id: question.id },
        data: { active: true },
      });
    }
  });

  it("returns_404_for_unknown_uuid_session", async () => {
    const response = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${unknownSessionId}`),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.error).toBe("not_found");
  });

  it("rejects_malformed_session_id_before_database_lookup", async () => {
    const response = await getAssessment(
      new Request("http://localhost/api/assessment?sessionId=missing-session"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain("sessionId");
  });

  it("rejects_invalid_patch_payload", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        version: 0,
        data: {
          age: 121,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
  });

  it("rejects_numeric_injection_and_null_numeric_values", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        version: 0,
        data: {
          age: "32; DROP TABLE users;",
          heightCm: null,
          weightKg: "72kg",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toEqual(
      expect.arrayContaining(["data.age", "data.heightCm", "data.weightKg"]),
    );
  });

  it("rejects_invalid_extended_questionnaire_values", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 4,
        version: 0,
        data: {
          workoutDaysPerWeek: 8,
          sleepHours: 25,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toEqual(
      expect.arrayContaining(["data.workoutDaysPerWeek", "data.sleepHours"]),
    );
  });

  it("accepts_long_session_minutes_for_two_hour_plus_training", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 7,
        version: 0,
        data: {
          workoutDaysPerWeek: 5,
          sessionMinutes: 150,
          workoutLocation: "gym",
        },
      }),
    );

    expect(response.status).toBe(200);
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    const answer = await prisma.assessmentAnswer.findFirstOrThrow({
      where: {
        assessmentId: assessment.id,
        question: { key: "sessionMinutes" },
      },
    });
    expect(answer.valueNumber).toBe(150);
  });

  it("rejects_session_minutes_over_supported_training_range", async () => {
    const sessionId = await createSessionId();

    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 7,
        version: 0,
        data: {
          sessionMinutes: 241,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain(
      "data.sessionMinutes",
    );
  });
});

async function createSessionId() {
  const response = await createSession(jsonRequest("POST", "/api/sessions", {}));
  const body = await response.json();
  createdSessionIds.add(body.sessionId);
  return body.sessionId as string;
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
