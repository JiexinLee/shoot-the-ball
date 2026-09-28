import "express-async-errors";
import { logger } from "./src/config/logger";
import { env } from "./src/config/env";

logger.info(
  {
    apiInternalTokenFirst8: env.API_INTERNAL_TOKEN
      ? env.API_INTERNAL_TOKEN.slice(0, 8) + "***"
      : "(EMPTY ⚠️)",
    devBypassAuth: env.DEV_BYPASS_AUTH,
    fixedUserId: env.DEV_FIXED_USER_ID,
    fixedUserEmail: env.DEV_FIXED_USER_EMAIL,
    fixedUserName: env.DEV_FIXED_USER_NAME,
    apiPort: env.API_PORT,
    apiHost: env.API_HOST,
    nodeEnv: env.NODE_ENV,
    appEnv: env.APP_ENV,
    databaseUrlFirst12: env.DATABASE_URL
      ? env.DATABASE_URL.slice(0, 12) + "***"
      : "(EMPTY ⚠️)",
    redisUrlFirst12: env.REDIS_URL
      ? env.REDIS_URL.slice(0, 12) + "***"
      : "(EMPTY — will use HOST/PORT fallback)",
    storageProvider: env.STORAGE_PROVIDER,
    storageEndpoint: env.STORAGE_ENDPOINT || "(EMPTY)",
    storageBucketSource: env.STORAGE_BUCKET_SOURCE,
    storageBucketExports: env.STORAGE_BUCKET_EXPORTS,
    ssePollIntervalMs: env.JOBS_SSE_POLL_INTERVAL_MS,
    sseMaxConnectionMs: env.JOBS_SSE_MAX_CONNECTION_MS,
  },
  "✅ env probe passed — all envalid checks passed. Review above values look correct.",
);

console.log("\n✅  Env probe summary:");
console.log(
  "    API_INTERNAL_TOKEN  :",
  env.API_INTERNAL_TOKEN
    ? `${env.API_INTERNAL_TOKEN.slice(0, 8)}***`
    : "EMPTY (warn: must match ai-worker/.env.local!)",
);
console.log("    DEV_BYPASS_AUTH     :", env.DEV_BYPASS_AUTH);
console.log(
  "    DATABASE_URL        :",
  env.DATABASE_URL ? `${env.DATABASE_URL.slice(0, 20)}...` : "EMPTY ⚠️",
);
console.log(
  "    REDIS_URL           :",
  env.REDIS_URL
    ? `${env.REDIS_URL.slice(0, 20)}...`
    : `fallback HOST=${env.REDIS_HOST}:${env.REDIS_PORT}`,
);
console.log(
  "    STORAGE             :",
  `${env.STORAGE_PROVIDER} endpoint=${env.STORAGE_ENDPOINT || "(empty)"} buckets=${env.STORAGE_BUCKET_SOURCE}/${env.STORAGE_BUCKET_EXPORTS}`,
);
console.log(
  "    API                 :",
  `http://${env.API_HOST}:${env.API_PORT}${env.API_PREFIX}`,
);
