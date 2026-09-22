import dotenv from 'dotenv';
import { cleanEnv, host, port, str, num } from 'envalid';

dotenv.config({ path: ['.env.local', '.env', '../../.env'] });

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'test', 'production', 'staging'],
    default: 'development',
  }),
  APP_ENV: str({
    choices: ['development', 'test', 'production', 'staging'],
    default: 'development',
  }),

  API_HOST: host({ default: '0.0.0.0' }),
  API_PORT: port({ default: 4000 }),
  API_PREFIX: str({ default: '/v1' }),
  API_CORS_ORIGIN: str({ default: '*' }),

  JWT_SECRET: str(),
  JWT_EXPIRES_IN: str({ default: '7d' }),

  DATABASE_URL: str(),

  REDIS_HOST: host({ default: '127.0.0.1' }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),
  REDIS_DB: num({ default: 0 }),
  REDIS_URL: str({ default: '' }),

  STORAGE_PROVIDER: str({ choices: ['s3', 'r2'], default: 's3' }),
  STORAGE_ENDPOINT: str({ default: '' }),
  STORAGE_REGION: str({ default: 'ap-southeast-1' }),
  STORAGE_ACCESS_KEY_ID: str({ default: '' }),
  STORAGE_SECRET_ACCESS_KEY: str({ default: '' }),
  STORAGE_BUCKET_SOURCE: str({ default: 'shoot-the-ball-source' }),
  STORAGE_BUCKET_EXPORTS: str({ default: 'shoot-the-ball-exports' }),
  STORAGE_PRESIGNED_UPLOAD_TTL: num({ default: 900 }),
  STORAGE_PRESIGNED_DOWNLOAD_TTL: num({ default: 3600 }),

  BULLMQ_CONCURRENCY: num({ default: 2 }),
  BULLMQ_PROCESSING_QUEUE: str({ default: 'video-processing' }),
  BULLMQ_EXPORT_QUEUE: str({ default: 'video-export' }),
});

export type Env = typeof env;
