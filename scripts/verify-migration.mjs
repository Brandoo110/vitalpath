import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(root, "prisma", "migrations");
const consistencyMigrationPath = path.join(migrationRoot, "20260930090000_backend_consistency", "migration.sql");
const wellnessMigrationPath = path.join(migrationRoot, "20260930103000_wellness_v2", "migration.sql");
const ownershipMigrationPath = path.join(migrationRoot, "20260930120000_result_assessment_owner", "migration.sql");
const consistencyMigration = await fs.readFile(consistencyMigrationPath, "utf8");
const wellnessMigration = await fs.readFile(wellnessMigrationPath, "utf8");
const ownershipMigration = await fs.readFile(ownershipMigrationPath, "utf8");
const oldMigrations = (await fs.readdir(migrationRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && ![
    "20260930090000_backend_consistency",
    "20260930103000_wellness_v2",
    "20260930120000_result_assessment_owner",
  ].includes(entry.name))
  .map((entry) => entry.name)
  .sort();

const sourceUrl = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
if (!sourceUrl.hostname) throw new Error("DIRECT_URL or DATABASE_URL is required");
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const suffix = Date.now();
const databases = [
  `vitalpath_migration_retained_${suffix}`,
  `vitalpath_migration_conflict_${suffix}`,
  `vitalpath_migration_orphan_${suffix}`,
  `vitalpath_migration_numeric_${suffix}`,
  `vitalpath_migration_completed_${suffix}`,
  `vitalpath_migration_answer_${suffix}`,
  `vitalpath_migration_owner_${suffix}`,
];

try {
  for (const database of databases) await createDatabase(database);
  await verifyRetained(databases[0]);
  await verifyFailure(databases[1], async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "subscriptionStatus") VALUES ('00000000-0000-4000-8000-000000000101', 'free');
      INSERT INTO "subscriptions" ("id", "userId", "status", "plan", "paidAt") VALUES ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000101', 'active', 'monthly', CURRENT_TIMESTAMP);
    `);
  }, "subscription status conflict");
  await verifyFailure(databases[2], async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "subscriptionStatus") VALUES ('00000000-0000-4000-8000-000000000201', 'free');
      INSERT INTO "subscriptions" ("id", "userId", "status") VALUES ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201', 'free');
      INSERT INTO "results" ("id", "userId", "bmi", "bmiCategory", "recommendedCalories", "targetDate") VALUES ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000201', 22, 'normal', 1800, CURRENT_TIMESTAMP);
    `);
  }, "result has no assessment history");
  await verifyFailure(databases[3], async (client) => {
    await insertUserAndAssessment(client, "00000000-0000-4000-8000-000000000301", { height: 0 });
  }, "assessments_height_range_check");
  await verifyFailure(databases[4], async (client) => {
    await insertUserAndAssessment(client, "00000000-0000-4000-8000-000000000401", { completed: true, height: null });
  }, "completed assessment is missing required health fields");
  await verifyFailure(databases[5], async (client) => {
    await insertUserAndAssessment(client, "00000000-0000-4000-8000-000000000501");
    await client.query(`
      INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText", "valueNumber")
      VALUES ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000501-assessment', 'question_session_minutes', '30', 30)
    `);
  }, "assessment answer must contain exactly one value");
  await verifyOwnershipRollback(databases[6]);
  console.log("Migration verification passed: retained data plus conflict, orphan, numeric, completion and answer rollback cases");
} finally {
  for (const database of databases) await dropDatabase(database).catch(() => undefined);
}

async function verifyRetained(database) {
  await applyOldMigrations(database);
  await withDatabase(database, async (client) => {
    await insertUserAndAssessment(client, "00000000-0000-4000-8000-000000000001", { step: 3, version: 3 });
    await client.query(`
      INSERT INTO "assessment_answers" ("id", "assessmentId", "questionId", "valueText") VALUES ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001-assessment', 'question_pace_preference', 'standard');
      INSERT INTO "results" ("id", "userId", "bmi", "bmiCategory", "recommendedCalories", "targetDate") VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 26.4, 'overweight', 1467, CURRENT_TIMESTAMP);
    `);
    await client.query(consistencyMigration);
    await client.query(wellnessMigration);
    await client.query(ownershipMigration);
    const retained = await client.query(`
      SELECT u."id", a."age", a."version", a."wellnessEligible", aa."valueText", r."assessmentId", r."sourceAssessmentVersion", r."recommendedCalories", r."targetDate", r."calculationDetails", r."algorithmVersion", s."status", s."plan",
             (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscriptionStatus') AS "oldStatusColumn"
      FROM "users" u
      JOIN "assessments" a ON a."userId" = u."id"
      JOIN "assessment_answers" aa ON aa."assessmentId" = a."id"
      JOIN "results" r ON r."userId" = u."id"
      JOIN "subscriptions" s ON s."userId" = u."id"
      WHERE u."id" = '00000000-0000-4000-8000-000000000001'
    `);
    const row = retained.rows[0];
    if (!row || row.age !== 32 || row.version !== 3 || row.wellnessEligible !== null || row.valueText !== "standard" || !row.assessmentId || row.sourceAssessmentVersion !== null || row.recommendedCalories !== 1467 || row.targetDate === null || row.calculationDetails !== null || row.algorithmVersion !== "v1" || row.status !== "free" || row.plan !== null || row.oldStatusColumn !== null) {
      throw new Error("legal historical data was not retained with unknown v2 eligibility and calculation semantics");
    }
    await client.query(`UPDATE "results" SET "targetDate" = NULL, "calculationDetails" = '{"projectionStatus":"maintenance"}' WHERE "id" = '00000000-0000-4000-8000-000000000003'`);
    const nullable = await client.query(`SELECT "targetDate", "calculationDetails" FROM "results" WHERE "id" = '00000000-0000-4000-8000-000000000003'`);
    if (nullable.rows[0].targetDate !== null || nullable.rows[0].calculationDetails?.projectionStatus !== "maintenance") {
      throw new Error("wellness v2 nullable result columns were not accepted");
    }
  });
}

async function verifyOwnershipRollback(database) {
  await applyOldMigrations(database);
  await withDatabase(database, async (client) => {
    await client.query(`
      INSERT INTO "users" ("id", "subscriptionStatus") VALUES
        ('00000000-0000-4000-8000-000000000601', 'free'),
        ('00000000-0000-4000-8000-000000000602', 'free');
      INSERT INTO "subscriptions" ("id", "userId", "status") VALUES
        ('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000601', 'free'),
        ('00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000602', 'free');
      INSERT INTO "assessments" ("id", "userId", "gender", "goal", "age", "heightCm", "weightKg", "targetWeightKg", "activityLevel", "version", "updatedAt") VALUES
        ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000601', 'female', 'lose_weight', 32, 165, 72, 62, 'light', 1, CURRENT_TIMESTAMP),
        ('00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000602', 'female', 'lose_weight', 32, 165, 72, 62, 'light', 1, CURRENT_TIMESTAMP);
      INSERT INTO "results" ("id", "userId", "bmiCategory", "bmi", "recommendedCalories", "targetDate") VALUES
        ('00000000-0000-4000-8000-000000000631', '00000000-0000-4000-8000-000000000601', 'overweight', 26.4, 1467, CURRENT_TIMESTAMP);
    `);
    await client.query(consistencyMigration);
    await client.query(wellnessMigration);
    await client.query(`
      UPDATE "results"
      SET "assessmentId" = '00000000-0000-4000-8000-000000000622'
      WHERE "id" = '00000000-0000-4000-8000-000000000631';
    `);
    await expectFailure(client.query(ownershipMigration), "results_assessmentId_userId_fkey");
    await client.query("ROLLBACK");
    const constraint = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'results_assessmentId_userId_fkey'
      ) AS "ownerConstraint"
    `);
    if (constraint.rows[0].ownerConstraint) {
      throw new Error("cross-user ownership migration left a partial constraint");
    }
  });
}

async function verifyFailure(database, setup, expectedText) {
  await applyOldMigrations(database);
  await withDatabase(database, async (client) => {
    await setup(client);
    await expectFailure(client.query(consistencyMigration), expectedText);
    await client.query("ROLLBACK");
    const rolledBack = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscriptionStatus') AS "oldStatus",
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'results' AND column_name = 'assessmentId') AS "newResultColumn"
    `);
    if (!rolledBack.rows[0].oldStatus || rolledBack.rows[0].newResultColumn) {
      throw new Error(`failed migration did not roll back for ${expectedText}`);
    }
  });
}

async function insertUserAndAssessment(client, userId, options = {}) {
  const assessmentId = `${userId}-assessment`;
  await client.query(`INSERT INTO "users" ("id", "subscriptionStatus") VALUES ($1, 'free')`, [userId]);
  await client.query(`INSERT INTO "subscriptions" ("id", "userId", "status") VALUES ($1, $2, 'free')`, [`${userId}-subscription`, userId]);
  await client.query(`
    INSERT INTO "assessments" ("id", "userId", "age", "heightCm", "weightKg", "targetWeightKg", "gender", "goal", "activityLevel", "step", "completed", "version", "updatedAt")
    VALUES ($1, $2, 32, $3, 72, 62, 'female', 'lose_weight', 'light', 3, $4, 3, CURRENT_TIMESTAMP)
  `, [assessmentId, userId, Object.hasOwn(options, "height") ? options.height : 165, options.completed ?? false]);
}

async function applyOldMigrations(database) {
  await withDatabase(database, async (client) => {
    for (const migration of oldMigrations) {
      await client.query(await fs.readFile(path.join(migrationRoot, migration, "migration.sql"), "utf8"));
    }
  });
}

async function createDatabase(database) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try { await client.query(`CREATE DATABASE ${quote(database)}`); } finally { await client.end(); }
}

async function dropDatabase(database) {
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try { await client.query(`DROP DATABASE IF EXISTS ${quote(database)}`); } finally { await client.end(); }
}

async function withDatabase(database, callback) {
  const url = new URL(sourceUrl);
  url.pathname = `/${database}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

async function expectFailure(promise, expectedText) {
  try { await promise; } catch (error) {
    if (!String(error).includes(expectedText)) throw error;
    return;
  }
  throw new Error(`expected migration failure containing ${expectedText}`);
}

function quote(identifier) { return `"${identifier.replaceAll('"', '""')}"`; }
