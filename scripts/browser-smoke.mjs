import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const nextBin = path.resolve("node_modules/next/dist/bin/next");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logPath = `/tmp/vitalpath-browser-smoke-${process.pid}.log`;
const createdSessionIds = new Set();
let server;
let serverExit;
let serverOutput = "";
let browser;
let page;
let cleanupError;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  serverOutput += `${line}\n`;
}

try {
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "-p", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  serverExit = new Promise((resolve) => server.once("exit", (code, signal) => resolve({ code, signal })));
  log(`server pid=${server.pid} port=${port}`);
  await waitForReady();

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(existsSync(executablePath) ? { executablePath } : {}) });
  page = await browser.newPage();
  page.setDefaultTimeout(7_000);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start" }).click();
  await recordCurrentSession();
  const firstSessionId = await currentSessionId();
  if (!firstSessionId) throw new Error("Start did not create an anonymous session");
  if (process.env.BROWSER_SMOKE_FAIL_AFTER === "session") throw new Error("controlled browser cleanup failure");

  let abortAssessmentOnce = true;
  await page.route("**/api/assessment?sessionId=*", async (route) => {
    if (abortAssessmentOnce) { abortAssessmentOnce = false; await route.abort("failed"); return; }
    await route.continue();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Setup failed", { exact: true }).waitFor();
  if ((await currentSessionId()) !== firstSessionId) throw new Error("bootstrap retry lost the session");
  await page.getByRole("button", { name: "Retry setup" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  await page.unroute("**/api/assessment?sessionId=*");
  await page.getByRole("button", { name: "Start", exact: true }).click();

  await page.getByRole("button", { name: /Female/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("heading", { name: "How old are you?" }).waitFor();
  if ((await currentSessionId()) !== firstSessionId) throw new Error("reload changed the anonymous session");

  const ageInput = page.getByLabel("Age");
  await ageInput.fill("32");
  let releaseSave;
  let saveRouteDone;
  await page.route("**/api/assessment**", async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    saveRouteDone = new Promise((resolve) => { releaseSave = resolve; });
    await new Promise((resolve) => { const originalRelease = releaseSave; releaseSave = () => { originalRelease(); resolve(); }; });
    await route.continue();
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(100);
  if (!(await ageInput.isDisabled())) throw new Error("busy save left the form input editable");
  releaseSave();
  await saveRouteDone;
  await page.unroute("**/api/assessment**");

  await page.getByLabel("Height").fill("165");
  await page.getByLabel("Current weight").fill("72");
  await page.getByLabel("Target weight").fill("62");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "What result are you working toward?" }).waitFor();
  await page.getByRole("button", { name: /Lose weight/ }).click();
  const conflictAssessment = await apiJson(page, `/api/assessment?sessionId=${firstSessionId}`);
  const conflictPatch = await apiJson(page, "/api/assessment", {
    method: "PATCH",
    body: { sessionId: firstSessionId, step: 3, version: conflictAssessment.body.version, data: { goal: "lose_weight" } },
  });
  if (conflictPatch.status !== 200) throw new Error(`conflict setup PATCH failed: ${JSON.stringify(conflictPatch)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Your saved answers changed elsewhere/).waitFor();
  if (!(await page.getByRole("button", { name: /Lose weight/ }).getAttribute("class"))?.includes("selected")) {
    throw new Error("version conflict discarded the local goal draft");
  }
  await page.getByRole("button", { name: "Load saved answers and replace this draft" }).click();
  await page.getByRole("heading", { name: "What result are you working toward?" }).waitFor();

  await fillAssessment(page, true, true);
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await page.getByLabel("Save generated report").waitFor();
  await page.getByLabel("Name").fill("Browser Tester");
  await page.getByLabel("Email").fill("browser@example.com");
  await page.getByRole("button", { name: "View my report" }).click();
  await page.getByRole("region", { name: "Payment offer" }).waitFor();

  await page.getByRole("button", { name: /12-week plan/ }).click();
  let payCount = 0;
  const payRequests = (request) => { if (request.url().endsWith("/api/pay") && request.method() === "POST") payCount += 1; };
  page.on("request", payRequests);
  let abortReportOnce = true;
  await page.route("**/api/results?sessionId=*", async (route) => {
    if (abortReportOnce) { abortReportOnce = false; await route.abort("failed"); return; }
    await route.continue();
  });
  await page.getByRole("button", { name: "Get my plan" }).first().click();
  await page.getByText(/Payment succeeded, but the report could not be loaded/).waitFor();
  await page.getByRole("button", { name: "Retry report" }).first().click();
  await page.getByText("Plan unlocked").waitFor();
  if (payCount !== 1) throw new Error(`report retry posted payment ${payCount} times`);
  page.off("request", payRequests);
  await page.unroute("**/api/results?sessionId=*");

  let stalePatched = false;
  let staleStatus = null;
  await page.route("**/api/results?sessionId=*", async (route) => {
    if (!stalePatched) {
      const id = await currentSessionId();
      const assessment = await apiJson(page, `/api/assessment?sessionId=${id}`);
      const patchResponse = await apiJson(page, "/api/assessment", {
        method: "PATCH",
        body: { sessionId: id, step: 10, version: assessment.body.version, data: { weightKg: 71 } },
      });
      if (patchResponse.status !== 200) throw new Error(`stale setup PATCH failed: ${JSON.stringify(patchResponse)}`);
      stalePatched = true;
    }
    const response = await route.fetch();
    staleStatus = response.status();
    await route.fulfill({ response });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Generate my plan" }).waitFor();
  if (staleStatus !== 409) throw new Error(`stale browser request was not a real 409: ${staleStatus}`);
  if ((await currentSessionId()) !== firstSessionId) throw new Error("stale recovery discarded the paid session");
  if (await page.getByText("Setup failed", { exact: true }).count()) throw new Error("stale recovery entered Setup failed");
  await page.unroute("**/api/results?sessionId=*");

  await page.getByRole("button", { name: "Generate my plan" }).click();
  await page.getByLabel("Save generated report").waitFor();
  await page.getByLabel("Name").fill("Browser Tester");
  await page.getByLabel("Email").fill("browser@example.com");
  await page.getByRole("button", { name: "View my report" }).click();
  await page.getByText("Plan unlocked").waitFor();

  const expiredSessionId = await prepareSession(page, true);
  await databaseQuery('UPDATE "results" SET "algorithmVersion" = $1 WHERE "userId" = $2', ["wellness-v1", expiredSessionId]);
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), expiredSessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Generate my plan" }).waitFor();
  if ((await currentSessionId()) !== expiredSessionId) throw new Error("algorithm expiry recovery changed the session");

  const ctaCases = [
    { name: "top", planLabel: /4-week plan/, plan: "monthly", click: () => page.getByRole("button", { name: "Get my plan" }).first() },
    { name: "preview", planLabel: /1-week trial/, plan: "trial", click: () => page.getByRole("button", { name: /Unlock all/ }) },
    { name: "card", planLabel: /12-week plan/, plan: "quarterly", click: () => page.getByRole("button", { name: /Get my 30% off plan now/ }) },
  ];
  for (const testCase of ctaCases) {
    const id = await prepareSession(page, false);
    await page.evaluate((sessionId) => window.localStorage.setItem("vitalpath-session-id", sessionId), id);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("region", { name: "Payment offer" }).waitFor();
    await page.getByRole("button", { name: testCase.planLabel }).click();
    let postedPlan;
    const capturePay = (request) => { if (request.url().endsWith("/api/pay") && request.method() === "POST") postedPlan = request.postDataJSON()?.plan; };
    page.on("request", capturePay);
    await testCase.click().click();
    await page.getByText("Plan unlocked").waitFor();
    page.off("request", capturePay);
    if (postedPlan !== testCase.plan) throw new Error(`${testCase.name} CTA used ${postedPlan}, expected ${testCase.plan}`);
  }

  log(`Browser smoke passed session=${firstSessionId} staleStatus=${staleStatus} payPosts=${payCount} log=${logPath}`);
} catch (error) {
  if (page) {
    try { log(`page=${(await page.locator("body").innerText()).slice(0, 1000)}`); } catch { /* page may already be closed */ }
  }
  log(`Browser smoke failed: ${error instanceof Error ? error.stack : String(error)}`);
  throw error;
} finally {
  try { if (browser) await browser.close(); } catch (error) { cleanupError ??= error; }
  try {
    if (createdSessionIds.size && process.env.DATABASE_URL) {
      await databaseQuery('DELETE FROM "users" WHERE "id" = ANY($1::text[])', [[...createdSessionIds]]);
    }
  } catch (error) { cleanupError ??= error; }
  try { await stopServer(); } catch (error) { cleanupError ??= error; }
  try { writeFileSync(logPath, serverOutput, "utf8"); } catch (error) { cleanupError ??= error; }
  if (cleanupError) {
    console.error(`Browser smoke cleanup failed; log=${logPath}`, cleanupError);
    if (!process.exitCode) process.exitCode = 1;
  }
}

async function fillAssessment(currentPage, skipAge = false, bodyAlreadyResolved = false) {
  if (!skipAge) {
    await currentPage.getByLabel("Age").fill("32");
    await currentPage.getByRole("button", { name: "Continue" }).click();
  }
  if (!bodyAlreadyResolved) {
    await currentPage.getByLabel("Height").fill("165");
    await currentPage.getByLabel("Current weight").fill("72");
    await currentPage.getByLabel("Target weight").fill("62");
    await currentPage.getByRole("button", { name: "Continue" }).click();
  }
  await currentPage.getByRole("button", { name: /Keep fit/ }).click();
  await currentPage.getByText(/Keep fit uses an equal target weight/).waitFor();
  await currentPage.getByRole("button", { name: /Lose weight/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: "Standard" }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: /Light/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: /4 days/ }).click();
  await currentPage.getByRole("button", { name: /≤30 min/ }).click();
  await currentPage.getByRole("button", { name: /Home/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: /High protein/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByLabel("Sleep").fill("6.5");
  await currentPage.getByRole("button", { name: /Medium/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: /No time/ }).click();
  await currentPage.getByText("I agree to use my health data.").click();
  await currentPage.getByText("I confirm this estimate applies to me.").click();
}

async function prepareSession(currentPage, paid) {
  const created = await apiJson(currentPage, "/api/sessions", { method: "POST", body: {} });
  if (created.status !== 201) throw new Error(`fixture session failed: ${JSON.stringify(created)}`);
  const id = created.body.sessionId;
  createdSessionIds.add(id);
  const saved = await apiJson(currentPage, "/api/assessment", {
    method: "PATCH",
    body: {
      sessionId: id, step: 10, version: 0,
      data: {
        gender: "female", goal: "lose_weight", age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62,
        activityLevel: "light", pacePreference: "standard", workoutDaysPerWeek: 4, sessionMinutes: 30,
        workoutLocation: "home", dietPreference: "high_protein", sleepHours: 6.5, stressLevel: "medium",
        mainBarrier: "no_time", healthDataConsent: true, wellnessEligible: true,
      },
    },
  });
  if (saved.status !== 200) throw new Error(`fixture assessment failed: ${JSON.stringify(saved)}`);
  const submitted = await apiJson(currentPage, "/api/assessment/submit", { method: "POST", body: { sessionId: id, version: 1 } });
  if (submitted.status !== 200) throw new Error(`fixture submit failed: ${JSON.stringify(submitted)}`);
  if (paid) {
    const payment = await apiJson(currentPage, "/api/pay", { method: "POST", body: { sessionId: id, plan: "monthly" } });
    if (payment.status !== 200) throw new Error(`fixture payment failed: ${JSON.stringify(payment)}`);
  }
  return id;
}

async function apiJson(currentPage, url, options = {}) {
  return currentPage.evaluate(async ({ url: requestUrl, method, body }) => {
    const response = await fetch(requestUrl, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { url, method: options.method ?? "GET", body: options.body });
}

async function recordCurrentSession() {
  const id = await currentSessionId();
  if (id) { createdSessionIds.add(id); log(`session=${id}`); }
}

async function currentSessionId() {
  return page.evaluate(() => window.localStorage.getItem("vitalpath-session-id"));
}

async function databaseQuery(text, values = []) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await client.query(text, values); } finally { await client.end(); }
}

async function waitForReady() {
  const started = Date.now();
  while (!/ready/i.test(serverOutput)) {
    if (Date.now() - started > 30_000) throw new Error(`Next server did not start: ${serverOutput}`);
    if (server?.exitCode !== null) throw new Error(`Next server exited: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  try { await Promise.race([serverExit, timeout(5_000, "browser server did not stop after SIGTERM")]); }
  catch (error) {
    try { process.kill(-server.pid, "SIGKILL"); } catch (killError) { if (killError.code !== "ESRCH") throw killError; }
    await Promise.race([serverExit, timeout(5_000, "browser server did not stop after SIGKILL")]);
    if (!(error instanceof Error && /did not stop/.test(error.message))) throw error;
  }
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const address = listener.address();
  const selected = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => listener.close(resolve));
  return selected;
}

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
