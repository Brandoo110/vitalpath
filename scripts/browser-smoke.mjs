import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const nextBin = path.resolve("node_modules/next/dist/bin/next");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let sessionId;
let serverOutput = "";
let serverExit;

try {
  server = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "-p", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  serverExit = new Promise((resolve) => server.once("exit", (code, signal) => resolve({ code, signal })));
  await waitForReady();

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(executablePath) ? { executablePath } : {}),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await page.getByRole("button", { name: "Start" }).click();
  sessionId = await page.evaluate(() => window.localStorage.getItem("vitalpath-session-id"));

  await page.getByRole("button", { name: /Female/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Age").fill("32");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Height").fill("165");
  await page.getByLabel("Current weight").fill("72");
  await page.getByLabel("Target weight").fill("62");
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
  await page.getByText("I agree to use my health data.").click();
  await page.getByText("I confirm this estimate applies to me.").click();

  const finalButton = page.getByRole("button", { name: "Generate my plan" });
  await finalButton.click();
  await page.getByLabel("Save generated report").waitFor();
  await page.getByLabel("Name").fill("Browser Tester");
  await page.getByLabel("Email").fill("browser@example.com");
  await page.getByRole("button", { name: "View my report" }).click();
  await page.getByRole("region", { name: "Payment offer" }).waitFor();

  await page.getByRole("button", { name: /12-week plan/ }).click();
  let paymentBody;
  let blockReportRead = true;
  await page.route("**/api/results?sessionId=**", async (route) => {
    if (blockReportRead) {
      blockReportRead = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.on("request", (request) => {
    if (request.url().endsWith("/api/pay")) paymentBody = request.postDataJSON();
  });
  await page.getByRole("button", { name: "Get my plan" }).first().click();
  await page.getByText(/Payment succeeded, but the report could not be loaded/).waitFor();
  if (paymentBody?.plan !== "quarterly") throw new Error(`selected plan was not shared by CTA: ${JSON.stringify(paymentBody)}`);

  await page.unroute("**/api/results?sessionId=**");
  await page.getByRole("button", { name: "Get my plan" }).first().click();
  await page.getByText("Plan unlocked").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Plan unlocked").waitFor();

  sessionId = await page.evaluate(() => window.localStorage.getItem("vitalpath-session-id"));
  if (!sessionId) throw new Error("browser flow did not retain the anonymous session");
  const assessment = await page.evaluate(async (id) => (await fetch(`/api/assessment?sessionId=${id}`)).json(), sessionId);
  const staleResponse = await page.evaluate(async ({ id, version }) => {
    const response = await fetch("/api/assessment", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: id, step: 10, version, data: { weightKg: 71 } }),
    });
    return { status: response.status, body: await response.json() };
  }, { id: sessionId, version: assessment.version });
  if (staleResponse.status !== 200) throw new Error(`stale setup failed: ${JSON.stringify(staleResponse)}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start", exact: true }).waitFor();
  const retainedSessionId = await page.evaluate(() => window.localStorage.getItem("vitalpath-session-id"));
  if (retainedSessionId !== sessionId) throw new Error("stale recovery discarded the anonymous session");

  await browser.close();
  console.log("Browser smoke passed", JSON.stringify({ sessionId, selectedPlan: paymentBody.plan, staleStatus: staleResponse.status }));
} finally {
  if (sessionId && process.env.DATABASE_URL) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { await client.query('DELETE FROM "users" WHERE "id" = $1', [sessionId]); } finally { await client.end(); }
  }
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    await Promise.race([serverExit, timeout(5_000, "browser server did not stop")]);
  }
}

async function waitForReady() {
  const started = Date.now();
  while (!/ready/i.test(serverOutput)) {
    if (Date.now() - started > 30_000) throw new Error(`Next server did not start: ${serverOutput}`);
    if (server?.exitCode !== null) throw new Error(`Next server exited: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
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
