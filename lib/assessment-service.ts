import { Prisma } from "@/app/generated/prisma/client";

import { notFound } from "./errors";

type BeforeUserLockHook = (userId: string) => void | Promise<void>;

let beforeUserLockHook: BeforeUserLockHook | null = null;

/** Test-only scheduling seam; it never replaces the database lock. */
export function setBeforeUserLockHook(hook: BeforeUserLockHook | null) {
  beforeUserLockHook = hook;
}

export async function lockAssessment(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "assessments" WHERE "userId" = ${userId} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await beforeUserLockHook?.(userId);
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
  );
  if (!rows[0]) throw notFound("Session not found");
}

export const assessmentWithAnswers = {
  answers: { include: { question: true } },
} as const;
