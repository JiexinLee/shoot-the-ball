import Redis from "ioredis";
import { Queue } from "bullmq";
import { env } from "../config/env";
import { logger } from "../config/logger";
import {
  enqueueProcessingJob as _enqueueProcessing,
  enqueueExportJob as _enqueueExport,
} from "./handlers";
import type { ProcessingJobPayload, ExportJobPayload } from "./handlers";

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = env.REDIS_URL
      ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
      : new Redis({
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
          password: env.REDIS_PASSWORD || undefined,
          db: env.REDIS_DB,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });

    redisClient.on("error", (err) => {
      logger.error(err, "Redis connection error");
    });

    redisClient.on("ready", () => {
      logger.info("Redis connected successfully");
    });
  }
  return redisClient;
}

export function createProcessingQueue(): Queue {
  return new Queue(env.BULLMQ_PROCESSING_QUEUE, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
}

export function createExportQueue(): Queue {
  return new Queue(env.BULLMQ_EXPORT_QUEUE, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
}

/**
 * 便捷封装：创建临时 processing queue -> enqueue -> 关 queue。
 * 这样 routes 里 import 一个函数就行，不用每次管 queue 生命周期。
 */
export async function enqueueProcessingJob(
  payload: ProcessingJobPayload,
): Promise<string> {
  const q = createProcessingQueue();
  try {
    return await _enqueueProcessing(q, payload);
  } finally {
    await q.close();
  }
}

export async function enqueueExportJob(
  payload: ExportJobPayload,
): Promise<void> {
  const q = createExportQueue();
  try {
    return await _enqueueExport(q, payload);
  } finally {
    await q.close();
  }
}

export async function closeQueues(queues: Queue[]): Promise<void> {
  for (const q of queues) {
    await q.close();
  }
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
