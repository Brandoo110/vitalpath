import { spawn } from "node:child_process";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const port = Number(process.env.HTTP_SMOKE_PORT ?? 3187);
const baseUrl = `http://127.0.0.1:${port}`;
let sessionId;
const server = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "-p", String(port)], {
  stdio: "ignore",
  env: process.env,
});

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${options?.method ?? "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

try {
  await waitForServer();
  const session = await request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ healthDataConsent: true }),
  });
  sessionId = session.sessionId;

  const first = await request("/api/assessment", json("PATCH", {
    sessionId,
    step: 1,
    version: 0,
    data: { gender: "female", goal: "lose_weight", age: 32 },
  }));
  const second = await request("/api/assessment", json("PATCH", {
    sessionId,
    step: 9,
    version: first.version,
    data: {
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
    },
  }));
  const restored = await request(`/api/assessment?sessionId=${sessionId}`);
  if (restored.version !== second.version || restored.assessment?.age !== 32) {
    throw new Error("assessment recovery did not return the saved version and fields");
  }
  await request("/api/assessment/submit", json("POST", { sessionId, version: second.version }));
  const free = await request(`/api/results?sessionId=${sessionId}`);
  if (!free.needPaywall || "recommendedCalories" in free.result || "targetDate" in free.result || "plan" in free.result) {
    throw new Error("free results leaked protected fields");
  }
  await request("/api/pay", json("POST", { sessionId, plan: "monthly" }));
  const paid = await request(`/api/results?sessionId=${sessionId}`);
  if (paid.needPaywall || typeof paid.result.recommendedCalories !== "number" || !paid.result.targetDate || !paid.result.plan) {
    throw new Error("paid results did not expose the complete report");
  }
  console.log("HTTP smoke passed", { sessionId, version: second.version });
} finally {
  await cleanup();
  server.kill("SIGTERM");
}

function json(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      // The Next server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next HTTP server did not start within 30 seconds");
}

async function cleanup() {
  if (!sessionId || !process.env.DATABASE_URL) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('DELETE FROM "users" WHERE "id" = $1', [sessionId]);
  } finally {
    await client.end();
  }
}
