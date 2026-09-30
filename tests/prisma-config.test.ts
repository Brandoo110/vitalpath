import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prismaPgCalls: [] as unknown[],
  prismaClientCalls: [] as unknown[],
  PrismaPg: vi.fn(function (config: unknown) {
    mocks.prismaPgCalls.push(config);
    return { config };
  }),
  PrismaClient: vi.fn(function (config: unknown) {
    mocks.prismaClientCalls.push(config);
    return { config };
  }),
}));

vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.PrismaPg }));
vi.mock("@/app/generated/prisma/client", () => ({ PrismaClient: mocks.PrismaClient }));

const databaseUrl = "postgresql://demo-user:demo-password@example.test:6543/vitalpath?schema=public";
const ca = "-----BEGIN CERTIFICATE-----\nexample-ca\n-----END CERTIFICATE-----\n";
const mixedSslUrlCases = [
  ["sslmode", "verify-full"],
  ["sslrootcert", "/tmp/supabase-root-ca.pem"],
  ["sslcert", "/tmp/client-cert.pem"],
  ["sslkey", "/tmp/client-key.pem"],
  ["ssl", "0"],
  ["ssl", "no-verify"],
  ["sslnegotiation", "direct"],
] as const;

async function importPrismaModule() {
  vi.resetModules();
  clearPrismaGlobal();
  return import("@/lib/prisma");
}

function clearPrismaGlobal() {
  delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
}

describe("Prisma PostgreSQL connection configuration", () => {
  beforeEach(() => {
    mocks.prismaPgCalls.length = 0;
    mocks.prismaClientCalls.length = 0;
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("DATABASE_SSL_CA", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearPrismaGlobal();
  });

  it("keeps the existing connection config when no CA is configured", async () => {
    const localUrl = `${databaseUrl}&sslmode=require`;
    vi.stubEnv("DATABASE_URL", localUrl);

    await importPrismaModule();

    expect(mocks.prismaPgCalls).toEqual([{ connectionString: localUrl }]);
    expect(mocks.prismaClientCalls).toEqual([{ adapter: { config: { connectionString: localUrl } } }]);
  });

  it("passes the configured CA with certificate verification enabled", async () => {
    vi.stubEnv("DATABASE_SSL_CA", ca);

    await importPrismaModule();

    expect(mocks.prismaPgCalls).toEqual([
      {
        connectionString: databaseUrl,
        ssl: { ca, rejectUnauthorized: true },
      },
    ]);
  });

  it.each(mixedSslUrlCases)(
    "rejects DATABASE_SSL_CA mixed with the %s URL parameter",
    async (parameter, value) => {
      vi.stubEnv("DATABASE_SSL_CA", ca);
      vi.stubEnv("DATABASE_URL", `${databaseUrl}&${parameter}=${encodeURIComponent(value)}&token=super-secret`);

      let thrown: unknown;
      try {
        await importPrismaModule();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toMatch(new RegExp(`DATABASE_SSL_CA.*DATABASE_URL.*${parameter}`));
      expect(String(thrown)).not.toContain("super-secret");
      expect(mocks.prismaPgCalls).toHaveLength(0);
      expect(mocks.prismaClientCalls).toHaveLength(0);
    },
  );
});
