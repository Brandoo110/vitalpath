import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/app/generated/prisma/client";

const SSL_URL_PARAMETERS = [
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "ssl",
  "sslnegotiation",
] as const;

function getDatabaseUrl() {
  // Prisma 7 运行时通过 driver adapter 读 DATABASE_URL；迁移走 prisma.config.ts 的 DIRECT_URL。
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize PrismaClient");
  }
  return databaseUrl;
}

function getSslUrlParameter(databaseUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return undefined;
  }

  return Array.from(parsedUrl.searchParams.keys()).find((parameter) =>
    SSL_URL_PARAMETERS.includes(parameter.toLowerCase() as (typeof SSL_URL_PARAMETERS)[number]),
  );
}

function getDatabaseConnectionConfig() {
  const databaseUrl = getDatabaseUrl();
  const configuredCa = process.env.DATABASE_SSL_CA;

  if (configuredCa?.trim()) {
    const sslUrlParameter = getSslUrlParameter(databaseUrl);
    if (sslUrlParameter) {
      throw new Error(
        `DATABASE_SSL_CA cannot be combined with DATABASE_URL query parameter "${sslUrlParameter}"; remove that parameter from DATABASE_URL.`,
      );
    }

    return {
      connectionString: databaseUrl,
      ssl: {
        ca: configuredCa,
        rejectUnauthorized: true as const,
      },
    };
  }

  return { connectionString: databaseUrl };
}

function createPrismaClient() {
  const adapter = new PrismaPg(getDatabaseConnectionConfig());
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
