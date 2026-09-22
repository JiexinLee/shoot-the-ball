import pino from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.isDevelopment ? 'debug' : 'info',
  base: { service: 'api' },
  transport: env.isDevelopment
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      }
    : undefined,
});
