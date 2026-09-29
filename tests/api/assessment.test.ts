import { afterEach, describe, expect, it } from "vitest";

import { GET as getAssessment, PATCH as patchAssessment } from "@/app/api/assessment/route";
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
    expect(body).toEqual({
      sessionId,
      healthDataConsent: false,
      assessment: null,
      step: 0,
      completed: false,
      version: 0,
    });
  });

  it("restores_progress_after_partial_patch", async () => {
    const sessionId = await createSessionId();

    const patchResponse = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
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
        data: { gender: "male" },
      }),
    );
    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        data: { gender: "male" },
      }),
    );

    const count = await prisma.assessment.count({ where: { userId: sessionId } });
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });

    expect(count).toBe(1);
    expect(assessment.step).toBe(1);
    expect(assessment.version).toBe(2);
  });

  it("does_not_regress_step_on_out_of_order_patch", async () => {
    const sessionId = await createSessionId();

    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 4,
        data: { goal: "get_toned" },
      }),
    );
    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
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

  it("allows_patch_without_version_for_simple_clients", async () => {
    const sessionId = await createSessionId();

    await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 1,
        data: { age: 31 },
      }),
    );
    const response = await patchAssessment(
      jsonRequest("PATCH", "/api/assessment", {
        sessionId,
        step: 2,
        data: { age: 32 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(2);

    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.age).toBe(32);
  });

  it("returns_404_for_unknown_uuid_session", async () => {
    const response = await getAssessment(
      new Request(`http://localhost/api/assessment?sessionId=${unknownSessionId}`),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
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
