import http from "node:http";
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
let serverExitResult;
let ready;
let serverOutput = "";
let serverSpawnError;
let dropProxy;

try {
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "-p", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  console.log("HTTP smoke child", JSON.stringify({ pid: server.pid, port }));
  ready = new Promise((resolve) => {
    let settled = false;
    const resolveOnce = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    server.stdout.on("data", (chunk) => {
      serverOutput += chunk.toString();
      if (/\bready\b/i.test(serverOutput)) resolveOnce();
    });
    server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  });
  serverExit = new Promise((resolve) => {
    let settled = false;
    const resolveOnce = (result) => {
      if (!settled) {
        settled = true;
        serverExitResult = result;
        resolve(result);
      }
    };
    const completed = (code, signal) => resolveOnce({ code, signal, error: serverSpawnError, output: serverOutput });
    server.once("exit", completed);
    server.once("close", completed);
    server.once("error", (error) => { serverSpawnError = String(error); });
  });

  await waitForReady();
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

  dropProxy = await createDropResponseProxy(baseUrl);
  const invalidProxyResponse = await fetch(dropProxy.url("/api/assessment"), json("PATCH", {
    sessionId, step: -1, version: 0, data: {},
  }));
  const invalidProxyBody = await invalidProxyResponse.json();
  if (invalidProxyResponse.status !== 400 || invalidProxyBody.error !== "bad_request") {
    throw new Error("drop proxy did not propagate a deterministic non-2xx upstream response");
  }
  const invalidEvidence = dropProxy.lastUpstream();
  if (invalidEvidence.status !== 400 || JSON.parse(invalidEvidence.body).error !== "bad_request") {
    throw new Error("drop proxy did not retain the non-2xx upstream evidence");
  }
  await expectDroppedRequest(dropProxy.url("/api/assessment"), json("PATCH", {
    sessionId, step: 1, version: 0,
    data: { gender: "female", goal: "lose_weight", age: 32 },
  }));
  const first = await request(`/api/assessment?sessionId=${sessionId}`);
  if (first.version !== 1 || first.assessment?.gender !== "female" || first.assessment?.age !== 32) {
    throw new Error("dropped PATCH response did not leave the saved version and values readable");
  }
  const patchEvidence = dropProxy.lastUpstream();
  if (patchEvidence.status !== 200 || JSON.parse(patchEvidence.body).version !== 1) {
    throw new Error("drop proxy did not retain the successful PATCH response evidence");
  }
  const stalePatch = await fetch(`${baseUrl}/api/assessment`, json("PATCH", {
    sessionId, step: 2, version: 0,
    data: { gender: "male" },
  }));
  const staleBody = await stalePatch.json();
  if (stalePatch.status !== 409 || staleBody.error !== "version_conflict") {
    throw new Error("stale PATCH did not return version_conflict");
  }
  const afterConflict = await request(`/api/assessment?sessionId=${sessionId}`);
  if (afterConflict.version !== 1 || afterConflict.assessment?.gender !== "female") {
    throw new Error("stale PATCH overwrote the committed values");
  }
  const second = await request("/api/assessment", json("PATCH", {
    sessionId, step: 9, version: first.version,
    data: {
      heightCm: 165, weightKg: 72, targetWeightKg: 62, activityLevel: "light",
      pacePreference: "standard", workoutDaysPerWeek: 4, sessionMinutes: 30,
      workoutLocation: "home", dietPreference: "high_protein", sleepHours: 6.5,
      stressLevel: "medium", mainBarrier: "no_time", wellnessEligible: true,
    },
  }));
  const restored = await request(`/api/assessment?sessionId=${sessionId}`);
  if (restored.version !== second.version || restored.assessment?.age !== 32) {
    throw new Error("assessment recovery did not return the saved version and fields");
  }
  await expectDroppedRequest(dropProxy.url("/api/assessment/submit"), json("POST", {
    sessionId,
    version: second.version,
  }));
  const submitEvidence = dropProxy.lastUpstream();
  if (submitEvidence.status !== 200 || !JSON.parse(submitEvidence.body).resultId) {
    throw new Error("drop proxy did not retain the successful submit response evidence");
  }
  const replayedSubmit = await request("/api/assessment/submit", json("POST", {
    sessionId,
    version: second.version,
  }));
  if (!replayedSubmit.resultId || replayedSubmit.resultId !== JSON.parse(submitEvidence.body).resultId) {
    throw new Error("submit replay did not recover the same committed result");
  }
  const free = await request(`/api/results?sessionId=${sessionId}`);
  if (!free.needPaywall || "recommendedCalories" in free.result || "targetDate" in free.result || "plan" in free.result ||
      free.report?.algorithmVersion !== "wellness-v2" || !free.lockedFields?.includes("calculationDetails")) {
    throw new Error("free results leaked protected fields");
  }
  await expectDroppedRequest(dropProxy.url("/api/pay"), json("POST", { sessionId, plan: "monthly" }));
  const payEvidence = dropProxy.lastUpstream();
  const firstPay = JSON.parse(payEvidence.body);
  if (payEvidence.status !== 200 || firstPay.subscriptionStatus !== "active" || firstPay.plan !== "monthly" || !firstPay.paidAt) {
    throw new Error("drop proxy did not retain the successful pay response evidence");
  }
  const replayedPay = await request("/api/pay", json("POST", { sessionId, plan: "monthly" }));
  const repeatedPay = await request("/api/pay", json("POST", { sessionId, plan: "monthly" }));
  if (replayedPay.paidAt !== firstPay.paidAt || repeatedPay.paidAt !== firstPay.paidAt ||
      replayedPay.plan !== firstPay.plan || repeatedPay.plan !== firstPay.plan ||
      replayedPay.subscriptionStatus !== firstPay.subscriptionStatus || repeatedPay.subscriptionStatus !== firstPay.subscriptionStatus) {
    throw new Error("pay replay did not preserve paidAt");
  }
  await assertSingleSubscription(sessionId, firstPay);
  const paid = await request(`/api/results?sessionId=${sessionId}`);
  if (paid.needPaywall || typeof paid.result.recommendedCalories !== "number" || !paid.result.plan || !paid.result.calculationDetails ||
      paid.report?.algorithmVersion !== "wellness-v2" || paid.lockedFields?.length !== 0) {
    throw new Error("paid results did not expose the complete report");
  }
  console.log("HTTP smoke passed", { sessionId, version: second.version });
} finally {
  try {
    await dropProxy?.close();
    await cleanup();
  } finally {
    const stopped = await stopServer();
    console.log("HTTP smoke child stopped", JSON.stringify({
      pid: server?.pid,
      port,
      code: stopped?.code ?? null,
      signal: stopped?.signal ?? null,
    }));
  }
}

async function createDropResponseProxy(upstreamUrl) {
  let lastUpstream;
  const proxy = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const upstream = await fetch(`${upstreamUrl}${request.url}`, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => key !== "host")),
        body,
        duplex: "half",
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      lastUpstream = { status: upstream.status, body: upstreamBody.toString("utf8") };
      if (!upstream.ok) {
        response.statusCode = upstream.status;
        response.setHeader("content-type", "application/json");
        response.end(upstreamBody);
        return;
      }
      // The upstream has committed, then the client connection is destroyed.
      response.destroy();
    } catch (error) {
      response.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const address = proxy.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: (pathname) => `http://127.0.0.1:${port}${pathname}`,
    lastUpstream: () => {
      if (!lastUpstream) throw new Error("drop proxy has no upstream response evidence");
      return lastUpstream;
    },
    close: () => new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve())),
  };
}

async function expectDroppedRequest(url, options) {
  try {
    await fetch(url, options);
  } catch {
    return;
  }
  throw new Error(`expected the dropped response from ${url}`);
}

async function assertSingleSubscription(userId, expected) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query('SELECT "status", "plan", "paidAt" AT TIME ZONE \'UTC\' AS "paidAt" FROM "subscriptions" WHERE "userId" = $1', [userId]);
    const row = result.rows[0];
    const actualPaidAt = row?.paidAt ? new Date(row.paidAt).toISOString() : null;
    if (result.rowCount !== 1 || row.status !== expected.subscriptionStatus || row.plan !== expected.plan || actualPaidAt !== expected.paidAt) {
      throw new Error(`pay replay did not leave one stable subscription: rows=${result.rowCount}, expectedPaidAt=${expected.paidAt ?? "null"}, actualPaidAt=${actualPaidAt ?? "null"}`);
    }
  } finally {
    await client.end();
  }
}

function json(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function waitForReady() {
  const result = await Promise.race([
    ready,
    serverExit.then((exit) => { throw new Error(`Next HTTP server exited before Ready: ${JSON.stringify(exit)}`); }),
    timeout(30_000, "Next HTTP server did not emit Ready within 30 seconds"),
  ]);
  return result;
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
  if (!server || !serverExit) return null;
  if (serverExitResult) return serverExitResult;
  let result;
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  result = await settled(serverExit, 5_000);
  if (result) return result;
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  result = await settled(serverExit, 5_000);
  if (!result) throw new Error("Next HTTP server did not exit after SIGKILL");
  return result;
}

async function settled(promise, milliseconds) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), milliseconds);
    timer.unref();
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
