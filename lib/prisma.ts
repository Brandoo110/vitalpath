import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/app/generated/prisma/client";

function getDatabaseUrl() {
  // Prisma 7 运行时通过 driver adapter 读 DATABASE_URL；迁移走 prisma.config.ts 的 DIRECT_URL。
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize PrismaClient");
  }
  return databaseUrl;
}

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
  return new PrismaClient({ adapter });
}

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClientSingleton;
};

// 开发环境复用同一个 PrismaClient，避免 Next 热重载时反复创建连接。
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
