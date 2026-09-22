import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDb, disconnectDb } from './db/prisma';
import { apiV1Router } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.API_CORS_ORIGIN === '*' ? true : env.API_CORS_ORIGIN.split(','),
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  morgan(env.isDevelopment ? 'dev' : 'combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }),
);

app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'shoot-the-ball-api',
    version: '0.1.0',
    docs: `${env.API_PREFIX}/health`,
  });
});

app.use(env.API_PREFIX, apiV1Router);

app.use(notFoundHandler);
app.use(errorHandler);

let server: ReturnType<typeof app.listen> | null = null;

export async function start(): Promise<void> {
  await connectDb();
  server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      { host: env.API_HOST, port: env.API_PORT, env: env.NODE_ENV },
      `API listening on http://${env.API_HOST}:${env.API_PORT}`,
    );
  });
}

export async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down API server...');
  if (server) {
    server.close((err) => {
      if (err) logger.error(err, 'Error while closing HTTP server');
    });
  }
  await disconnectDb();
  logger.info('API server shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(err, 'Uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

if (require.main === module) {
  start().catch((err) => {
    logger.error(err, 'Failed to start API server');
    process.exit(1);
  });
}

export { app };
