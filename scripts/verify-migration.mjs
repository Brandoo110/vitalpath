import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldMigrationRoot = path.join(root, "prisma", "migrations");
const newMigration = path.join(oldMigrationRoot, "20260930090000_backend_consistency", "migration.sql");
const oldMigrations = (await fs.readdir(oldMigrationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== "20260930090000_backend_consistency")
  .map((entry) => entry.name)
  .sort();

const sourceUrl = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
if (!sourceUrl.hostname) throw new Error("DIRECT_URL or DATABASE_URL is required");
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";

const retainedDb = `vitalpath_migration_retained_${Date.now()}`;
const conflictDb = `vitalpath_migration_conflict_${Date.now()}`;

try {
  await createDatabase(retainedDb);
  await createDatabase(conflictDb);
  await applyOldMigrations(retainedDb);
  await applyOldMigrations(conflictDb);

  await withDatabase(retainedDb, async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "subscriptionStatus") VALUES ('00000000-0000-4000-8000-000000000001', 'free');
      INSERT INTO "subscriptions" ("id", "userId", "status") VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'free');
      INSERT INTO "assessments" ("id", "userId", "age", "heightCm", "weightKg", "targetWeightKg", "gender", "goal", "activityLevel", "step", "version", "updatedAt")
      VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 32, 165, 72, 62, 'female', 'lose_weight', 'light', 3, 3, CURRENT_TIMESTAMP);
      INSERT INTO "results" ("id", "userId", "bmi", "bmiCategory", "recommendedCalories", "targetDate")
      VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 26.4, 'overweight', 1467, CURRENT_TIMESTAMP);
    `);
    await client.query(await fs.readFile(newMigration, "utf8"));
    const retained = await client.query(`
      SELECT r."assessmentId", r."sourceAssessmentVersion", r."algorithmVersion",
             (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscriptionStatus') AS "oldStatusColumn"
      FROM "results" r WHERE r."id" = '00000000-0000-4000-8000-000000000003'
    `);
    if (!retained.rows[0].assessmentId || retained.rows[0].sourceAssessmentVersion !== null || retained.rows[0].algorithmVersion !== "v1" || retained.rows[0].oldStatusColumn !== null) {
      throw new Error("legal historical data was not retained and bound as expected");
    }
  });

  await withDatabase(conflictDb, async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "subscriptionStatus") VALUES ('00000000-0000-4000-8000-000000000101', 'free');
      INSERT INTO "subscriptions" ("id", "userId", "status", "plan", "paidAt") VALUES ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000101', 'active', 'monthly', CURRENT_TIMESTAMP);
    `);
    await expectFailure(client.query(await fs.readFile(newMigration, "utf8")), "subscription status conflict");
    await client.query("ROLLBACK");
    const rolledBack = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscriptionStatus') AS "oldStatus",
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'results' AND column_name = 'assessmentId') AS "newResultColumn"
    `);
    if (!rolledBack.rows[0].oldStatus || rolledBack.rows[0].newResultColumn) throw new Error("failed migration did not roll back");
  });

  console.log("Migration verification passed: legal history retained; conflict rejected and rolled back");
} finally {
  await dropDatabase(retainedDb).catch(() => undefined);
  await dropDatabase(conflictDb).catch(() => undefined);
}

async function applyOldMigrations(database) {
  await withDatabase(database, async (client) => {
    for (const migration of oldMigrations) {
      await client.query(await fs.readFile(path.join(oldMigrationRoot, migration, "migration.sql"), "utf8"));
    }
  });
}

async function createDatabase(database) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quote(database)}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(database) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${quote(database)}`);
  } finally {
    await client.end();
  }
}

async function withDatabase(database, callback) {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function expectFailure(promise, expectedText) {
  try {
    await promise;
  } catch (error) {
    if (!String(error).includes(expectedText)) throw error;
    return;
  }
  throw new Error(`expected migration failure containing ${expectedText}`);
}

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
