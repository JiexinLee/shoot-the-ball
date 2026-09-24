import 'express-async-errors';
import { logger } from './config/logger';
import { env } from './config/env';
logger.info({ sample: env.API_INTERNAL_TOKEN, dev: env.DEV_BYPASS_AUTH, poll: env.JOBS_SSE_POLL_INTERVAL_MS, max: env.JOBS_SSE_MAX_CONNECTION_MS, fixedId: env.DEV_FIXED_USER_ID, fixedEmail: env.DEV_FIXED_USER_EMAIL, fixedName: env.DEV_FIXED_USER_NAME, port: env.API_PORT, host: env.API_HOST }, 'env probe');
