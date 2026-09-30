import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
let reportScreenshotsSaved = false;
let discountDismissals = 0;

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
  const discountOffer = page.getByRole("dialog", { name: "Discount offer", exact: true });
  const dismissDiscountOffer = async (dialog) => {
    await dialog.getByRole("button", { name: "Maybe later", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    discountDismissals += 1;
  };
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
  await waitForRestoredLandingReady();
  await page.unroute("**/api/assessment?sessionId=*");
  await openRestoredFunnelAt("Which biological sex should we use for the estimate?");

  await page.getByRole("button", { name: /Female/ }).click();
  let genderPayloadKeys;
  const genderSaveResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/assessment" &&
    response.request().method() === "PATCH" &&
    response.request().postDataJSON()?.sessionId === firstSessionId &&
    response.request().postDataJSON()?.data?.gender === "female" &&
    (genderPayloadKeys = Object.keys(response.request().postDataJSON().data))
  );
  const [savedGender] = await Promise.all([
    genderSaveResponse,
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
  if (savedGender.status() !== 200) throw new Error(`gender save failed before reload: ${savedGender.status()}`);
  if (JSON.stringify(genderPayloadKeys) !== JSON.stringify(["gender"])) throw new Error(`gender PATCH included unrelated fields: ${genderPayloadKeys}`);
  await page.getByRole("heading", { name: "How old are you?", exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await openRestoredFunnelAt("How old are you?");
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
    body: { sessionId: firstSessionId, step: 3, version: conflictAssessment.body.version, data: { goal: "get_toned" } },
  });
  if (conflictPatch.status !== 200) throw new Error(`conflict setup PATCH failed: ${JSON.stringify(conflictPatch)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/Your saved answers changed elsewhere/).waitFor();
  if (!(await page.getByRole("button", { name: /Lose weight/ }).getAttribute("class"))?.includes("selected")) {
    throw new Error("version conflict discarded the local goal draft");
  }
  await page.getByRole("button", { name: "Load saved answers and replace this draft" }).click();
  await page.getByText("Saved answers loaded", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "How active are you right now?" }).waitFor();
  const loadedAssessment = await apiJson(page, `/api/assessment?sessionId=${firstSessionId}`);
  if (loadedAssessment.body.assessment?.goal !== "get_toned" || loadedAssessment.body.nextStep !== 5) {
    throw new Error(`loading saved answers did not apply the authoritative goal/nextStep: ${JSON.stringify(loadedAssessment.body)}`);
  }

  await fillAssessmentFromActivity(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await page.getByLabel("Save generated report").waitFor();
  await page.getByLabel("Name").fill("Browser Tester");
  await page.getByLabel("Email").fill("browser@example.com");
  await page.getByRole("button", { name: "View my report" }).click();
  await page.getByRole("region", { name: "Payment offer" }).waitFor();
  // Exercise the real exit-intent listener before any results-page reload can set its storage flag.
  const dismissalsBeforeExitIntent = discountDismissals;
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.dispatchEvent(new MouseEvent("mouseleave", { clientY: 0 }));
  });
  await discountOffer.waitFor({ state: "visible" });
  await dismissDiscountOffer(discountOffer);
  if (discountDismissals !== dismissalsBeforeExitIntent + 1) throw new Error("exit-intent offer was not dismissed through Maybe later before plan selection");
  // Register only after the explicit appearance/dismissal test, so it cannot consume that assertion.
  await page.addLocatorHandler(discountOffer, dismissDiscountOffer);
  await page.getByRole("button", { name: /12-week plan/ }).click();

  await page.getByText(/Model wellness-v2/).waitFor();

  const droppedPatchSessionId = await prepareBlankSession(page);
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), droppedPatchSessionId);
  await page.reload({ waitUntil: "networkidle" });
  await openRestoredFunnelAt("Which biological sex should we use for the estimate?");
  let patchPosts = 0;
  let droppedPatchBody;
  await page.route("**/api/assessment*", async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    patchPosts += 1;
    const response = await route.fetch();
    droppedPatchBody = await response.json();
    if (patchPosts === 1) { await route.abort("failed"); return; }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: /Female/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "How old are you?" }).waitFor();
  if (patchPosts !== 1 || droppedPatchBody?.version !== 1) throw new Error("dropped PATCH response did not recover from one real upstream write");
  await page.unroute("**/api/assessment*");

  const droppedPaySessionId = await prepareSession(page, false);
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), droppedPaySessionId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("region", { name: "Payment offer" }).waitFor();
  const payBodies = [];
  await page.route("**/api/pay", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    payBodies.push(body);
    if (payBodies.length === 1) { await route.abort("failed"); return; }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Get my plan" }).first().click();
  await page.getByText("Plan unlocked", { exact: true }).waitFor();
  if (payBodies.length !== 2 || !payBodies[0].paidAt || payBodies[0].paidAt !== payBodies[1].paidAt || payBodies[0].plan !== "monthly" || payBodies[1].plan !== "monthly") {
    throw new Error("dropped pay response did not replay the same monthly paidAt");
  }
  await page.getByText(/Model wellness-v2/).waitFor();
  await page.unroute("**/api/pay");
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), firstSessionId);
  await page.reload({ waitUntil: "networkidle" });
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

  await assertReportDepth(firstSessionId);

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

  const beforeCancel = await apiJson(page, `/api/assessment?sessionId=${firstSessionId}`);
  await page.getByRole("button", { name: "Edit answers" }).click();
  await page.getByRole("heading", { name: "Which biological sex" }).waitFor();
  await page.getByText("Male", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "How old are you?" }).waitFor();
  let abortCancelOnce = true;
  await page.route("**/api/assessment?sessionId=*", async (route) => {
    if (abortCancelOnce) { abortCancelOnce = false; await route.abort("failed"); return; }
    await route.continue();
  });
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await page.getByText(/draft is still here/i).waitFor();
  await page.unroute("**/api/assessment?sessionId=*");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await page.getByRole("heading", { name: /personalized plan/i }).waitFor();
  const afterCancel = await apiJson(page, `/api/assessment?sessionId=${firstSessionId}`);
  if (afterCancel.body.version !== beforeCancel.body.version || afterCancel.body.assessment?.gender !== beforeCancel.body.assessment?.gender) {
    throw new Error("cancel editing changed the saved report after a failed refresh");
  }

  await page.getByRole("button", { name: "Edit answers" }).click();
  await page.getByRole("heading", { name: "Which biological sex" }).waitFor();
  for (let step = 0; step < 8; step += 1) await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "How is your recovery baseline?" }).waitFor();
  await page.getByLabel("Sleep").fill("");
  await page.getByRole("button", { name: "Continue" }).click();
  let clearPatchPosts = 0;
  let droppedClearPatchBody;
  await page.route("**/api/assessment**", async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    const requestData = route.request().postDataJSON()?.data;
    const response = await route.fetch();
    const body = await response.json();
    if (requestData?.sleepHours === null) {
      clearPatchPosts += 1;
      droppedClearPatchBody = body;
      if (clearPatchPosts === 1) { await route.abort("failed"); return; }
    }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save and update plan" }).click();
  await page.getByText("Plan unlocked", { exact: true }).waitFor();
  if (clearPatchPosts !== 1 || droppedClearPatchBody?.version !== beforeCancel.body.version + 1) {
    throw new Error("dropped clear PATCH response did not reconcile the upstream deletion");
  }
  await page.unroute("**/api/assessment**");
  const clearedAssessment = await apiJson(page, `/api/assessment?sessionId=${firstSessionId}`);
  if (clearedAssessment.body.assessment?.sleepHours !== undefined) throw new Error("cleared sleep answer returned after editing");
  const clearedReport = await apiJson(page, `/api/results?sessionId=${firstSessionId}`);
  if (clearedReport.status !== 200 || clearedReport.body.needPaywall || clearedReport.body.result.plan.basis.find((entry) => entry.field === "sleepHours")?.source !== "default") {
    throw new Error("paid report did not rebuild with the cleared sleep answer");
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Plan unlocked", { exact: true }).waitFor();
  const reloadedClearedReport = await apiJson(page, `/api/results?sessionId=${firstSessionId}`);
  if (reloadedClearedReport.status !== 200 || reloadedClearedReport.body.result.plan.basis.find((entry) => entry.field === "sleepHours")?.source !== "default") {
    throw new Error("cleared sleep answer was not restored after reload");
  }

  const normalClearSessionId = await prepareDraftSession(page, {
    gender: "female", goal: "lose_weight", age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62,
    sleepHours: 6.5,
  });
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), normalClearSessionId);
  await page.reload({ waitUntil: "networkidle" });
  await openRestoredFunnelAt("How active are you right now?");
  await page.getByRole("button", { name: /Light/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Design your weekly training rhythm." }).waitFor();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Pick the eating style you can keep." }).waitFor();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "How is your recovery baseline?" }).waitFor();
  await page.getByLabel("Sleep").fill("");
  const normalClearRequest = page.waitForRequest((request) => {
    if (!request.url().endsWith("/api/assessment") || request.method() !== "PATCH") return false;
    const data = request.postDataJSON()?.data;
    return data?.sleepHours === null;
  });
  await Promise.all([normalClearRequest, page.getByRole("button", { name: "Continue" }).click()]);
  const normalClearData = (await normalClearRequest).postDataJSON().data;
  if (JSON.stringify(Object.keys(normalClearData)) !== JSON.stringify(["sleepHours", "stressLevel"])) {
    throw new Error(`normal recovery clear PATCH included unrelated fields: ${Object.keys(normalClearData)}`);
  }

  const partialSessionId = await prepareDraftSession(page, {
    gender: "female", goal: "lose_weight", age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62,
  });
  await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), partialSessionId);
  await page.reload({ waitUntil: "networkidle" });
  await openRestoredFunnelAt("How active are you right now?");
  await fillRequiredFromActivity(page);
  await page.getByRole("button", { name: "Generate my plan" }).click();
  await page.getByLabel("Save generated report").waitFor();
  await page.getByLabel("Name").fill("Optional Skip Tester");
  await page.getByLabel("Email").fill("optional@example.com");
  await page.getByRole("button", { name: "View my report" }).click();
  await page.getByText(/Model wellness-v2/).waitFor();

  await assertFreeReport(partialSessionId);
  const optionalPay = await apiJson(page, "/api/pay", { method: "POST", body: { sessionId: partialSessionId, plan: "monthly" } });
  if (optionalPay.status !== 200) throw new Error("optional report unlock failed");
  await page.reload({ waitUntil: "networkidle" });
  await assertReportDepth(partialSessionId, true);

  for (const overrides of [
    { goal: "keep_fit", targetWeightKg: 72 },
    { goal: "gain_muscle", targetWeightKg: 100 },
  ]) {
    const projectionId = await prepareSession(page, true, overrides);
    await page.evaluate((id) => localStorage.setItem("vitalpath-session-id", id), projectionId);
    await page.reload({ waitUntil: "networkidle" });
    const scenario = await apiJson(page, `/api/results?sessionId=${projectionId}`);
    const expected = overrides.goal === "keep_fit" ? "maintenance" : "not_projected";
    if (scenario.body.result.calculationDetails.projectionStatus !== expected) throw new Error(`scenario fixture expected ${expected}`);
    await assertReportDepth(projectionId);
  }

  const unsupportedCases = [
    { name: "age", overrides: { age: 19 }, heading: "How old are you?", field: "Age", message: /age must be between 20 and 78/i, value: "19" },
    { name: "target BMI", overrides: { targetWeightKg: 49 }, heading: /Add your current and target body metrics/, field: "Target weight", message: /target BMI is outside/i, value: "49" },
  ];
  for (const unsupported of unsupportedCases) {
    const unsupportedSessionId = await prepareDraftSession(page, {
      gender: "female", goal: "lose_weight", age: 32, heightCm: 165, weightKg: 72, targetWeightKg: 62,
      activityLevel: "light", healthDataConsent: true, wellnessEligible: true, ...unsupported.overrides,
    });
    await page.evaluate((id) => window.localStorage.setItem("vitalpath-session-id", id), unsupportedSessionId);
    await page.reload({ waitUntil: "networkidle" });
    await openRestoredFunnelAt("What usually gets in the way?");
    await page.getByRole("button", { name: "Generate my plan" }).click();
    await page.getByRole("heading", { name: unsupported.heading }).waitFor();
    await page.getByText(unsupported.message).waitFor();
    if (await page.getByLabel(unsupported.field).inputValue() !== unsupported.value) {
      throw new Error(`${unsupported.name} 422 recovery did not preserve the invalid value for correction`);
    }
    if (unsupported.name === "age") {
      await page.getByLabel("Age").fill("32");
      await page.getByRole("button", { name: "Continue" }).click();
      for (let step = 0; step < 7; step += 1) await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Generate my plan" }).click();
      await page.getByLabel("Save generated report").waitFor();
      await page.getByLabel("Name").fill("Recovered Age Tester");
      await page.getByLabel("Email").fill("recovered-age@example.com");
      await page.getByRole("button", { name: "View my report" }).click();
      await page.getByText(/Model wellness-v2/).waitFor();
    }
  }

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

  log(`Browser smoke passed session=${firstSessionId} staleStatus=${staleStatus} payPosts=${payCount} discountDismissals=${discountDismissals} log=${logPath}`);
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

async function fillAssessmentFromActivity(currentPage) {
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

async function fillRequiredFromActivity(currentPage) {
  await currentPage.getByRole("button", { name: /Light/ }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByRole("button", { name: "Continue" }).click();
  await currentPage.getByText("I agree to use my health data.").click();
  await currentPage.getByText("I confirm this estimate applies to me.").click();
}

async function prepareDraftSession(currentPage, data) {
  const created = await apiJson(currentPage, "/api/sessions", { method: "POST", body: {} });
  if (created.status !== 201) throw new Error(`draft session failed: ${JSON.stringify(created)}`);
  const id = created.body.sessionId;
  createdSessionIds.add(id);
  const saved = await apiJson(currentPage, "/api/assessment", {
    method: "PATCH",
    body: { sessionId: id, step: 10, version: 0, data },
  });
  if (saved.status !== 200) throw new Error(`draft assessment failed: ${JSON.stringify(saved)}`);
  return id;
}

async function prepareBlankSession(currentPage) {
  const created = await apiJson(currentPage, "/api/sessions", { method: "POST", body: {} });
  if (created.status !== 201) throw new Error(`blank session failed: ${JSON.stringify(created)}`);
  createdSessionIds.add(created.body.sessionId);
  return created.body.sessionId;
}

async function prepareSession(currentPage, paid, overrides = {}) {
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
        mainBarrier: "no_time", healthDataConsent: true, wellnessEligible: true, ...overrides,
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

async function waitForStartReady() {
  const start = page.getByRole("button", { name: "Start", exact: true });
  await start.waitFor();
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Start"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
}

async function waitForRestoredLandingReady() {
  await page.getByText("Start fresh as a new user", { exact: true }).waitFor();
  await waitForStartReady();
}

async function openRestoredFunnelAt(headingName) {
  await waitForRestoredLandingReady();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("heading", { name: headingName }).waitFor();
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

async function assertFreeReport(id) {
  const { body, status } = await apiJson(page, `/api/results?sessionId=${id}`);
  if (status !== 200 || body.result.plan || body.result.calculationDetails) throw new Error("free report leaked protected data");
  for (const section of body.result.planPreview) {
    if (Object.keys(section).some((key) => !["id", "title", "preview"].includes(key))) throw new Error("free preview has paid fields");
  }
  if (await page.locator('[data-testid="plan-basis"], [data-testid="first-week"], [data-testid="energy-breakdown"]').count()) throw new Error("paid report content rendered in free DOM");
  await page.getByText(/BMI is a height-and-weight screening measure/).waitFor();
}

async function assertReportDepth(id, expectDefaults = false) {
  await page.getByText("Plan unlocked", { exact: true }).waitFor();
  const { body, status } = await apiJson(page, `/api/results?sessionId=${id}`);
  if (status !== 200 || !body.result.plan) throw new Error("paid plan unavailable");
  const plan = body.result.plan;
  const basis = page.getByTestId("plan-basis");
  for (const entry of plan.basis) {
    const row = basis.locator(`[data-field="${entry.field}"]`);
    await row.waitFor();
    if (await row.locator("dd").textContent() !== entry.value) throw new Error("basis value differs from API");
    await row.getByText(entry.source === "answer" ? "Your answer" : "Not answered · Default guidance", { exact: true }).waitFor();
  }
  if (expectDefaults && !plan.basis.some((entry) => entry.source === "default")) throw new Error("skipped preferences missing default source");
  for (const section of plan.sections) {
    const block = page.locator(`[data-plan-section="${section.id}"]`);
    await block.getByText(section.rationale, { exact: true }).waitFor();
    if (await block.locator("li").count() !== section.items.length) throw new Error("report truncated section items");
    for (const item of section.items) await block.getByText(item, { exact: true }).waitFor();
  }
  const days = page.getByTestId("first-week").locator("details");
  if (plan.firstWeek.length !== 7 || await days.count() !== 7) throw new Error("missing seven-day template");
  for (let index = 0; index < 7; index += 1) {
    const day = days.nth(index);
    await day.locator("summary").click();
    for (const action of plan.firstWeek[index].actions) await day.getByText(action, { exact: true }).waitFor();
    await day.locator("summary").click();
    if (await day.evaluate((element) => element.open)) throw new Error(`day ${index + 1} did not collapse`);
    await day.locator("ul").waitFor({ state: "hidden" });
  }
  for (const prompt of plan.reviewPrompts) await page.getByTestId("plan-review").getByText(prompt, { exact: true }).waitFor();
  const energy = page.getByTestId("energy-breakdown");
  const calculation = body.result.calculationDetails;
  const energyText = (value) => `${Math.round(value).toLocaleString("en-US")} kcal/day`;
  const displayed = await energy.locator("dd").allTextContents();
  const expectedEnergy = [energyText(calculation.REE), `× ${calculation.assumptions.activityMultiplier}`, energyText(calculation.TDEE), `${calculation.actualEnergyDifference > 0 ? "+" : ""}${energyText(calculation.actualEnergyDifference)}`];
  if (JSON.stringify(displayed) !== JSON.stringify(expectedEnergy)) throw new Error("report energy values differ from API");
  const projection = calculation.projectionStatus;
  await page.getByTestId("projection-explanation").getByText({
    projected: /conditional estimate, not a deadline or guarantee/,
    maintenance: /Equal current and target weight/,
    not_projected: /does not reach your target within one year/,
  }[projection]).waitFor();
  const viewport = page.viewportSize();
  const screenshotDir = process.env.REPORT_SCREENSHOT_DIR;
  const captureReport = screenshotDir && !reportScreenshotsSaved;
  if (captureReport) {
    mkdirSync(screenshotDir, { recursive: true });
    await captureReportScreenshots(screenshotDir, "desktop");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("390px report overflows horizontally");
  if (captureReport) {
    await captureReportScreenshots(screenshotDir, "390");
    reportScreenshotsSaved = true;
  }
  await page.setViewportSize(viewport);
}

async function captureReportScreenshots(directory, size) {
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.join(directory, `report-${size}.png`), fullPage: false });
  await page.screenshot({ path: path.join(directory, `report-${size}-full.png`), fullPage: true });
}
