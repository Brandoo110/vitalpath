import { afterEach, describe, expect, it, vi } from "vitest";

import { PATCH as patchAssessment } from "@/app/api/assessment/route";
import { POST as submitAssessment } from "@/app/api/assessment/submit/route";
import { POST as createSession } from "@/app/api/sessions/route";
import * as assessmentService from "@/lib/assessment-service";
import { prisma } from "@/lib/prisma";

const createdSessionIds = new Set<string>();
const activeBarriers = new Set<LockBarrier>();

const originalLockUser = assessmentService.lockUser;

afterEach(async () => {
  for (const barrier of activeBarriers) barrier.release();
  await Promise.race([
    Promise.allSettled([...activeBarriers].flatMap((barrier) => barrier.inflight())),
    timeout(5_000, "lock barrier cleanup timed out"),
  ]);
  for (const barrier of activeBarriers) barrier.restore();
  activeBarriers.clear();

  for (const sessionId of createdSessionIds) {
    await prisma.user.deleteMany({ where: { id: sessionId } });
  }
  createdSessionIds.clear();
});

describe("assessment aggregate lock ordering", () => {
  it("serializes first creation before submit and a following consent patch", async () => {
    const sessionId = await createSessionId();
    const barrier = lockBarrier();

    const creator = barrier.track(patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 1,
      version: 0,
      data: { gender: "female" },
    })));
    await barrier.firstAcquired;

    const waitingSubmit = barrier.track(submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 0,
    })));
    await barrier.waiterStarted;

    const followingPatch = barrier.track(patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 2,
      version: 1,
      data: { healthDataConsent: true },
    })));
    await barrier.thirdStarted;
    barrier.release();

    expect((await creator).status).toBe(200);
    expect((await waitingSubmit).status).toBe(409);
    expect((await followingPatch).status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: sessionId },
      include: { assessment: true },
    });
    expect(user.healthDataConsent).toBe(true);
    expect(user.assessment?.version).toBe(2);
  });

  it("keeps an existing submit first when patch waits for the user lock", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = lockBarrier();

    const submit = barrier.track(submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    })));
    await barrier.firstAcquired;
    const patch = barrier.track(patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 6,
      version: 1,
      data: { healthDataConsent: false },
    })));
    await barrier.waiterStarted;
    barrier.release();

    expect((await submit).status).toBe(200);
    expect((await patch).status).toBe(200);
    const assessment = await prisma.assessment.findUniqueOrThrow({ where: { userId: sessionId } });
    expect(assessment.version).toBe(2);
    expect(assessment.completed).toBe(false);
  });

  it("keeps an existing patch first when submit waits for the user lock", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = lockBarrier();

    const patch = barrier.track(patchAssessment(jsonRequest("PATCH", "/api/assessment", {
      sessionId,
      step: 6,
      version: 1,
      data: { weightKg: 70 },
    })));
    await barrier.firstAcquired;
    const submit = barrier.track(submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    })));
    await barrier.waiterStarted;
    barrier.release();

    expect((await patch).status).toBe(200);
    expect((await submit).status).toBe(409);
    expect((await submit).json()).resolves.toMatchObject({ error: "version_conflict" });
  });

  it("returns one stable result for same-version concurrent submits", async () => {
    const sessionId = await createSessionId();
    await saveCompleteAssessment(sessionId);
    const barrier = lockBarrier();

    const firstSubmit = barrier.track(submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    })));
    await barrier.firstAcquired;
    const secondSubmit = barrier.track(submitAssessment(jsonRequest("POST", "/api/assessment/submit", {
      sessionId,
      version: 1,
    })));
    await barrier.waiterStarted;
    barrier.release();

    const firstResponse = await firstSubmit;
    const firstBody = await firstResponse.json();
    const firstResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });
    const secondResponse = await secondSubmit;
    const secondBody = await secondResponse.json();
    const secondResult = await prisma.result.findUniqueOrThrow({ where: { userId: sessionId } });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.resultId).toBe(firstBody.resultId);
    expect(secondResult.calculatedAt).toEqual(firstResult.calculatedAt);
    expect(secondResult.targetDate).toEqual(firstResult.targetDate);
  });
});

type LockBarrier = ReturnType<typeof lockBarrier>;

function lockBarrier() {
  let calls = 0;
  let releaseGate!: () => void;
  let resolveFirstAcquired!: () => void;
  let resolveWaiterStarted!: () => void;
  let resolveThirdStarted!: () => void;
  let released = false;
  const hold = new Promise<void>((resolve) => {
    releaseGate = () => {
      if (!released) {
        released = true;
        resolve();
      }
    };
  });
  const firstAcquired = new Promise<void>((resolve) => { resolveFirstAcquired = resolve; });
  const waiterStarted = new Promise<void>((resolve) => { resolveWaiterStarted = resolve; });
  const thirdStarted = new Promise<void>((resolve) => { resolveThirdStarted = resolve; });
  const inflightRequests = new Set<Promise<unknown>>();
  const spy = vi.spyOn(assessmentService, "lockUser").mockImplementation(async (tx, userId) => {
    const call = ++calls;
    if (call === 2) {
      resolveWaiterStarted();
    } else if (call === 3) {
      resolveThirdStarted();
    }
    const result = await originalLockUser(tx, userId);
    if (call === 1) {
      resolveFirstAcquired();
      await hold;
    }
    return result;
  });

  const barrier = {
    firstAcquired,
    waiterStarted,
    thirdStarted,
    track<T>(request: Promise<T>) {
      inflightRequests.add(request);
      void request.then(
        () => inflightRequests.delete(request),
        () => inflightRequests.delete(request),
      );
      return request;
    },
    inflight() {
      return [...inflightRequests];
    },
    release: releaseGate,
    restore: () => spy.mockRestore(),
  };
  activeBarriers.add(barrier);
  return barrier;
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
      wellnessEligible: true,
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

function timeout(milliseconds: number, message: string) {
  return new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
