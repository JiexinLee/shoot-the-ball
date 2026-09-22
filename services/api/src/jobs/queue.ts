import Redis from 'ioredis';
import { Queue, Worker, QueueScheduler } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';

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

    redisClient.on('error', (err) => {
      logger.error(err, 'Redis connection error');
    });

    redisClient.on('ready', () => {
      logger.info('Redis connected successfully');
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
      backoff: { type: 'exponential', delay: 5000 },
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
      backoff: { type: 'exponential', delay: 5000 },
    },
  });
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
