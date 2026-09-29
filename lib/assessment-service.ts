import { Prisma } from "@/app/generated/prisma/client";

import { notFound } from "./errors";

export async function lockAssessment(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "assessments" WHERE "userId" = ${userId} FOR UPDATE`,
  );
  return rows[0]?.id ?? null;
}

export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`,
  );
  if (!rows[0]) throw notFound("Session not found");
}

export const assessmentWithAnswers = {
  answers: { include: { question: true } },
} as const;
