import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;

try {
  await verifyFailureCleanup();
  await verifyOccupiedPort();
  console.log("HTTP smoke failure cleanup and occupied-port checks passed");
} finally {
  // Each check closes only the child/dummy handles it created.
}

async function verifyFailureCleanup() {
  const run = await runSmoke({ HTTP_SMOKE_FAIL_AFTER: "session" });
  if (run.exit.code === 0) throw new Error("failure lifecycle did not fail");
  const stopped = lastJson(run.output, "HTTP smoke child stopped");
  if (!stopped?.pid || !stopped?.port) throw new Error(`missing child lifecycle record: ${run.output}`);
  await assertProcessGroupGone(stopped.pid);
  await assertPortReleased(stopped.port);
  const sessionMatch = run.output.match(/HTTP smoke session created ([0-9a-f-]{36})/i);
  if (!sessionMatch) throw new Error(`failure lifecycle did not report a session: ${run.output}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM "users" WHERE "id" = $1', [sessionMatch[1]]);
    if (result.rowCount !== 0) throw new Error("failed HTTP smoke left its session behind");
  } finally {
    await client.end();
  }
}

async function verifyOccupiedPort() {
  const dummy = net.createServer();
  let requestBytes = 0;
  dummy.on("connection", (socket) => {
    socket.on("data", (chunk) => { requestBytes += chunk.length; });
  });
  await listen(dummy, 0);
  const address = dummy.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const run = await runSmoke({ HTTP_SMOKE_PORT: String(port) });
    if (run.exit.code === 0) throw new Error("occupied-port smoke unexpectedly succeeded");
    if (requestBytes !== 0) throw new Error("occupied-port dummy received a business request");
    if (!dummy.listening) throw new Error("occupied-port dummy stopped unexpectedly");
  } finally {
    await close(dummy);
  }
}

async function runSmoke(overrides) {
  const child = spawn(process.execPath, ["scripts/http-smoke.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...overrides },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const exit = await Promise.race([
    new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => resolve({ error: String(error) }));
    }),
    timeout(45_000, "HTTP smoke child did not exit within 45 seconds"),
  ]).catch(async (error) => {
    child.kill("SIGTERM");
    await waitForChildExit(child, 5_000);
    throw error;
  });
  return { exit, output };
}

async function assertProcessGroupGone(pid) {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  throw new Error(`HTTP smoke process group ${pid} is still alive`);
}

async function assertPortReleased(port) {
  const probe = net.createServer();
  try {
    await listen(probe, port);
  } finally {
    await close(probe);
  }
}

function lastJson(output, label) {
  const matches = [...output.matchAll(new RegExp(`${label} (\\{[^\\n]+\\})`, "g"))];
  return matches.length ? JSON.parse(matches.at(-1)[1]) : null;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
}

function waitForChildExit(child, milliseconds) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref();
  });
}
