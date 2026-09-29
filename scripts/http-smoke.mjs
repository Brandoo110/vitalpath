import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const nextBin = path.resolve("node_modules/next/dist/bin/next");
const port = Number(process.env.HTTP_SMOKE_PORT ?? await freePort());
const baseUrl = `http://127.0.0.1:${port}`;
let sessionId;
let server;
let serverExit;

try {
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "-p", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  serverExit = new Promise((resolve) => {
    server.once("exit", (code, signal) => resolve({ code, signal, output }));
    server.once("error", (error) => resolve({ error, output }));
  });

  await waitForServer();
  const session = await request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ healthDataConsent: true }),
  });
  sessionId = session.sessionId;
  console.log("HTTP smoke session created", sessionId);
  if (process.env.HTTP_SMOKE_FAIL_AFTER === "session") {
    throw new Error("intentional HTTP smoke lifecycle failure");
  }

  const first = await request("/api/assessment", json("PATCH", {
    sessionId, step: 1, version: 0,
    data: { gender: "female", goal: "lose_weight", age: 32 },
  }));
  const second = await request("/api/assessment", json("PATCH", {
    sessionId, step: 9, version: first.version,
    data: {
      heightCm: 165, weightKg: 72, targetWeightKg: 62, activityLevel: "light",
      pacePreference: "standard", workoutDaysPerWeek: 4, sessionMinutes: 30,
      workoutLocation: "home", dietPreference: "high_protein", sleepHours: 6.5,
      stressLevel: "medium", mainBarrier: "no_time",
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
  try {
    await cleanup();
  } finally {
    await stopServer();
  }
}

function json(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      const details = await serverExit;
      throw new Error(`Next HTTP server exited before readiness: ${JSON.stringify(details)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok && server?.exitCode === null) return;
    } catch {
      // The Next server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next HTTP server did not start within 30 seconds");
}

async function request(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${options?.method ?? "GET"} ${pathname} -> ${response.status}: ${JSON.stringify(body)}`);
  return body;
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

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 5_000;
  while (server.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (server.exitCode === null) {
    try { process.kill(-server.pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await serverExit;
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  const selectedPort = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => listener.close(resolve));
  return selectedPort;
}
