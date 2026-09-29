import { spawn } from "node:child_process";
import process from "node:process";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const child = spawn(process.execPath, ["scripts/http-smoke.mjs"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HTTP_SMOKE_FAIL_AFTER: "session" },
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
if (exit.code === 0) throw new Error("failure lifecycle did not fail");
const match = output.match(/HTTP smoke session created ([0-9a-f-]{36})/i);
if (!match) throw new Error(`failure lifecycle did not report a session: ${output}`);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query('SELECT 1 FROM "users" WHERE "id" = $1', [match[1]]);
  if (result.rowCount !== 0) throw new Error("failed HTTP smoke left its session behind");
} finally {
  await client.end();
}
console.log("HTTP smoke failure cleanup passed", { sessionId: match[1] });
