import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../config/logger";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: env.isDevelopment ? ["error", "warn", "query"] : ["error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

export async function connectDb(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info("PostgreSQL connected successfully");
  } catch (err) {
    logger.error(err, "Failed to connect PostgreSQL");
    throw err;
  }
}

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
  logger.info("PostgreSQL disconnected");
}
