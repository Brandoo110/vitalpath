import { spawn } from "node:child_process";
import net from "node:net";
import pg from "pg";

import "dotenv/config";

const { Client } = pg;
const child = spawn(process.execPath, ["scripts/browser-smoke.mjs"], {
  env: { ...process.env, BROWSER_SMOKE_FAIL_AFTER: "session" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
if (exit.code === 0) throw new Error("controlled browser failure unexpectedly passed");

const port = Number(output.match(/server pid=\d+ port=(\d+)/)?.[1]);
const sessionId = output.match(/session=([0-9a-f-]{36})/)?.[1];
if (!port || !sessionId) throw new Error(`cleanup evidence missing from child output:\n${output}`);
if (await isPortOpen(port)) throw new Error(`browser server port ${port} is still open`);

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query('SELECT 1 FROM "users" WHERE "id" = $1', [sessionId]);
  if (result.rowCount !== 0) throw new Error(`controlled failure leaked session ${sessionId}`);
} finally {
  await client.end();
}
console.log(`Browser failure cleanup passed session=${sessionId} port=${port}`);

async function isPortOpen(portNumber) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: portNumber });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}
