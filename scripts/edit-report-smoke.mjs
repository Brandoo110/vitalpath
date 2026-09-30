import { chromium } from "@playwright/test";
import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.EDIT_REPORT_BASE_URL ?? "http://127.0.0.1:3000";
if (new URL(baseUrl).hostname !== "127.0.0.1") throw new Error("edit report smoke only accepts a 127.0.0.1 base URL");
if (!process.env.DATABASE_URL) throw new Error("edit report smoke requires DATABASE_URL for cleanup");
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)) {
  throw new Error("edit report smoke only accepts a loopback DATABASE_URL");
}
const createdSessionIds = new Set();
let browser;
let page;

try {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  browser = await chromium.launch({ headless: true, ...(await fileExists(executablePath) ? { executablePath } : {}) });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(7_000);

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const bootstrapSessionId = await page.evaluate(() => window.localStorage.getItem("vitalpath-session-id"));
  if (bootstrapSessionId) createdSessionIds.add(bootstrapSessionId);
  const sessionId = await prepareSession(true);
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), sessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /personalized plan/i }).waitFor();
  let payRequests = 0;
  let submitRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/pay") && request.method() === "POST") payRequests += 1;
    if (request.url().endsWith("/api/assessment/submit") && request.method() === "POST") submitRequests += 1;
  });

  const before = await api(`/api/assessment?sessionId=${sessionId}`);
  const beforeResults = await api(`/api/results?sessionId=${sessionId}`);
  const originalWeight = before.body.assessment.weightKg;
  const originalVersion = before.body.version;

  await page.getByRole("button", { name: "Edit answers" }).click();
  await page.getByRole("heading", { name: "Which biological sex" }).waitFor();
  const patchRequests = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/assessment") && request.method() === "PATCH") patchRequests.push(request);
  });
  await page.getByText("Male", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "How old are you?" }).waitFor();
  if (patchRequests.length !== 0) throw new Error(`editing Continue wrote ${patchRequests.length} PATCH request(s)`);

  let abortCancelOnce = true;
  await page.route("**/api/assessment?sessionId=*", async (route) => {
    if (abortCancelOnce) {
      abortCancelOnce = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await page.getByText(/draft is still here/i).waitFor();
  await page.getByRole("heading", { name: "How old are you?" }).waitFor();
  await page.unroute("**/api/assessment?sessionId=*");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await page.getByRole("heading", { name: /personalized plan/i }).waitFor();
  const afterCancel = await api(`/api/assessment?sessionId=${sessionId}`);
  const afterCancelResults = await api(`/api/results?sessionId=${sessionId}`);
  assertEqual(afterCancel.body.version, originalVersion, "cancel changed assessment version");
  assertEqual(afterCancel.body.assessment.gender, before.body.assessment.gender, "cancel changed saved gender");
  assertEqual(afterCancel.body.assessment.weightKg, originalWeight, "cancel changed saved weight");
  assertEqual(afterCancelResults.body.subscriptionStatus, "active", "cancel lost paid subscription");
  assertEqual(afterCancelResults.body.result.recommendedCalories, beforeResults.body.result.recommendedCalories, "cancel changed report");

  await page.getByRole("button", { name: "Edit answers" }).click();
  await page.getByRole("heading", { name: "Which biological sex" }).waitFor();
  await page.getByText("Male", { exact: true }).click();
  await advanceEditedForm();
  const beforeSave = patchRequests.length;
  let abortSubmitOnce = true;
  await page.route("**/api/assessment/submit", async (route) => {
    if (abortSubmitOnce && route.request().method() === "POST") {
      abortSubmitOnce = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save and update plan" }).click();
  await page.getByText(/answers were saved/i).waitFor();
  if (!(await page.getByRole("button", { name: "Generate my plan" }).isDisabled())) {
    throw new Error("saved-plan retry did not freeze the normal save button");
  }
  if (patchRequests.length !== beforeSave + 1) throw new Error(`failed submit expected one PATCH, saw ${patchRequests.length - beforeSave}`);
  const submitsAfterFailedSave = submitRequests;
  let abortResultsOnce = true;
  await page.route("**/api/results?sessionId=*", async (route) => {
    if (abortResultsOnce) {
      abortResultsOnce = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Retry generating the plan" }).click();
  await page.getByText(/updated plan is still unavailable/i).waitFor();
  if (submitRequests !== submitsAfterFailedSave + 1) throw new Error("submit retry did not make exactly one submit request");
  const patchesAfterSubmitRetry = patchRequests.length;
  await page.getByRole("button", { name: "Retry generating the plan" }).click();
  await page.getByRole("heading", { name: /personalized plan/i }).waitFor();
  if (submitRequests !== submitsAfterFailedSave + 1) throw new Error("results retry submitted the plan again");
  if (patchRequests.length !== patchesAfterSubmitRetry) throw new Error("results retry posted another PATCH");
  await page.unroute("**/api/results?sessionId=*");
  await page.unroute("**/api/assessment/submit");
  if (patchRequests.length !== beforeSave + 1) throw new Error(`save expected one PATCH, saw ${patchRequests.length - beforeSave}`);
  const saved = await api(`/api/assessment?sessionId=${sessionId}`);
  if (saved.body.version !== originalVersion + 1) throw new Error(`save expected version ${originalVersion + 1}, got ${saved.body.version}`);
  if (saved.body.assessment.gender !== "male") throw new Error("save did not persist edited gender");
  if (saved.body.assessment.age !== 33) throw new Error("save did not persist edited age");
  const finalResults = await api(`/api/results?sessionId=${sessionId}`);
  assertEqual(finalResults.body.subscriptionStatus, "active", "save lost paid subscription");
  assertEqual(payRequests, 0, "edit flow posted payment");
  if (await page.getByRole("heading", { name: /Save generated report/i }).count()) throw new Error("save returned to lead capture");

  await page.getByRole("button", { name: "Edit answers" }).click();
  await page.getByRole("heading", { name: "Which biological sex" }).waitFor();
  await page.getByText("Female", { exact: true }).click();
  const conflictAssessment = await api(`/api/assessment?sessionId=${sessionId}`);
  const conflictPatch = await api("/api/assessment", {
    method: "PATCH",
    body: { sessionId, step: 10, version: conflictAssessment.body.version, data: { age: 34 } },
  });
  if (conflictPatch.status !== 200) throw new Error(`conflict setup PATCH failed: ${JSON.stringify(conflictPatch)}`);
  await advanceEditedForm();
  await page.getByRole("button", { name: "Save and update plan" }).click();
  await page.getByText(/saved answers changed elsewhere/i).waitFor();
  for (let step = 0; step < 9; step += 1) await page.getByRole("button", { name: "Back" }).click();
  const preservedGender = page.getByText("Female", { exact: true }).locator("xpath=ancestor::button");
  if (!(await preservedGender.getAttribute("class"))?.includes("selected")) throw new Error("version conflict did not preserve the edit draft");
  console.log(`edit report smoke passed session=${sessionId} patchRequests=${patchRequests.length}`);
} catch (error) {
  if (page) console.error((await page.locator("body").innerText()).slice(0, 1800));
  throw error;
} finally {
  try { if (browser) await browser.close(); } finally {
    if (createdSessionIds.size && process.env.DATABASE_URL) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try { await client.query('DELETE FROM "users" WHERE "id" = ANY($1::text[])', [[...createdSessionIds]]); }
      finally { await client.end(); }
    }
  }
}

async function prepareSession(paid) {
  const created = await api("/api/sessions", { method: "POST", body: {} });
  if (created.status !== 201) throw new Error(`fixture session failed: ${JSON.stringify(created)}`);
  const sessionId = created.body.sessionId;
  createdSessionIds.add(sessionId);
  const saved = await api("/api/assessment", {
    method: "PATCH",
    body: {
      sessionId, step: 10, version: 0,
      data: {
        gender: "female", goal: "lose_weight", age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62,
        activityLevel: "light", pacePreference: "standard", workoutDaysPerWeek: 4, sessionMinutes: 30,
        workoutLocation: "home", dietPreference: "high_protein", sleepHours: 6.5, stressLevel: "medium",
        mainBarrier: "no_time", healthDataConsent: true, wellnessEligible: true,
      },
    },
  });
  if (saved.status !== 200) throw new Error(`fixture assessment failed: ${JSON.stringify(saved)}`);
  const submitted = await api("/api/assessment/submit", { method: "POST", body: { sessionId, version: 1 } });
  if (submitted.status !== 200) throw new Error(`fixture submit failed: ${JSON.stringify(submitted)}`);
  if (paid) {
    const payment = await api("/api/pay", { method: "POST", body: { sessionId, plan: "monthly" } });
    if (payment.status !== 200) throw new Error(`fixture payment failed: ${JSON.stringify(payment)}`);
  }
  return sessionId;
}

async function advanceEditedForm() {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Age").fill("33");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Lose weight/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Standard" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Light/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /4 days/ }).click();
  await page.getByRole("button", { name: /≤30 min/ }).click();
  await page.getByRole("button", { name: /Home/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /High protein/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Sleep").fill("6.5");
  await page.getByRole("button", { name: /Medium/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /No time/ }).click();
  const checkboxes = page.locator('input[type="checkbox"]');
  if (!(await checkboxes.nth(0).isChecked())) await page.getByText("I agree to use my health data.").click();
  if (!(await checkboxes.nth(1).isChecked())) await page.getByText("I confirm this estimate applies to me.").click();
}

async function api(url, options = {}) {
  return page.evaluate(async ({ url: requestUrl, method, body }) => {
    const response = await fetch(requestUrl, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, { url, method: options.method ?? "GET", body: options.body });
}

async function fileExists(filePath) {
  try { await (await import("node:fs/promises")).access(filePath); return true; } catch { return false; }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
