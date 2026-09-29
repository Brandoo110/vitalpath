import { afterEach, describe, expect, it } from "vitest";

import { PATCH as patchAssessment } from "@/app/api/assessment/route";
import { POST as submitAssessment } from "@/app/api/assessment/submit/route";
import { POST as createSession } from "@/app/api/sessions/route";
import { prisma } from "@/lib/prisma";
import { setBeforeUserLockHook } from "@/lib/assessment-service";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  setBeforeUserLockHook(null);
  for (const sessionId of createdSessionIds) {
    await prisma.user.deleteMany({ where: { id: sessionId } });
  }
  createdSessionIds.clear();
});

describe("assessment aggregate lock ordering", () => {
  it("serializes first creation before a competing submit", async () => {
    const sessionId = await createSessionId();
    const barrier = firstUserLockBarrier();

    const patchPromise = patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 1,
      version: 0,
      data: { gender: "female" },
    }));
    await barrier.firstEntered;

    const submitPromise = submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 0,
    }));
    await barrier.secondEntered;
    barrier.release();

    expect((await patchPromise).status).toBe(200);
    const submitResponse = await submitPromise;
    expect(submitResponse.status).toBe(409);
    expect((await submitResponse.json()).error).toBe("version_conflict");
  });

  it("lets an existing patch wait behind submit and preserves consent", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = firstUserLockBarrier();

    const submitPromise = submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    }));
    await barrier.firstEntered;

    const patchResponse = await patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 6,
      version: 1,
      data: { healthDataConsent: false },
    }));
    expect(patchResponse.status).toBe(200);

    barrier.release();
    const submitResponse = await submitPromise;
    expect(submitResponse.status).toBe(409);
    expect((await submitResponse.json()).error).toBe("version_conflict");
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: sessionId },
      include: { assessment: true },
    });
    expect(user.healthDataConsent).toBe(false);
    expect(user.assessment?.version).toBe(2);
  });

  it("keeps submit first when patch is the queued waiter", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = firstUserLockBarrier();

    const patchPromise = patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 6,
      version: 1,
      data: { weightKg: 70 },
    }));
    await barrier.firstEntered;

    const submitPromise = submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    }));
    await barrier.secondEntered;
    const submitResponse = await submitPromise;
    expect(submitResponse.status).toBe(200);

    barrier.release();
    expect((await patchPromise).status).toBe(200);
    const result = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(result.sourceAssessmentVersion).toBe(1);
  });

  it("returns one stable result for same-version concurrent submits", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = firstUserLockBarrier();

    const firstPromise = submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    }));
    await barrier.firstEntered;
    const secondPromise = submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    }));
    await barrier.secondEntered;
    barrier.release();

    const firstResponse = await firstPromise;
    expect(firstResponse.status).toBe(200);
    const firstResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    const secondResponse = await secondPromise;
    expect(secondResponse.status).toBe(200);
    expect((await firstResponse.json()).resultId).toBe((await secondResponse.json()).resultId);
    const secondResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(secondResult.calculatedAt).toEqual(firstResult.calculatedAt);
  });
});

function firstUserLockBarrier() {
  let calls = 0;
  let release!: () => void;
  const releaseFirst = new Promise<void>((resolve) => {
    let released = false;
    release = () => {
      if (!released) {
        released = true;
        resolve();
      }
    };
  });
  let resolveFirst!: () => void;
  let resolveSecond!: () => void;
  const entered = new Promise<void>((resolve) => { resolveFirst = resolve; });
  const secondEntered = new Promise<void>((resolve) => { resolveSecond = resolve; });
  setBeforeUserLockHook(async () => {
    calls += 1;
    if (calls === 1) {
      resolveFirst();
      await releaseFirst;
    } else if (calls === 2) {
      resolveSecond();
    }
  });
  return { firstEntered: entered, secondEntered, release };
}

async function createSessionId() {
  const response = await createSession(jsonRequest("POST", "/api/sessions", {}));
  const body = await response.json();
  createdSessionIds.add(body.sessionId);
  return body.sessionId as string;
}

async function saveCompleteAssessment(sessionId: string) {
  const response = await patchAssessment(jsonRequest("PATCH", "/api/assessment", {
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
  }));
  expect(response.status).toBe(200);
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
