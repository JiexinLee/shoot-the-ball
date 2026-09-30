import "express-async-errors";
import { installGlobalBigIntJsonPatch } from "./utils/serialize";
// 全局 BigInt JSON 补丁：必须放在所有业务 import 之前，确保任何 JSON.stringify 都不会
// 因为 Postgres BIGINT 被 Prisma 读成 JS BigInt 就炸 500。
installGlobalBigIntJsonPatch();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectDb, disconnectDb } from "./db/prisma";
import { apiV1Router } from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/error";

const app = express();

// =========================================================================
// 安全 & 基础中间件
// =========================================================================

/**
 * Helmet 设置各种安全响应头（X-Content-Type-Options / CSP / X-Frame-Options / HSTS 等）。
 * 后续如果需要更严格的 CSP（比如 img-src、media-src 允许 Cloudflare R2 域名），就在这里配置。
 */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // <video src="presigned R2 url"> 需要 cross-origin
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "media-src": ["'self'", "blob:", "data:", "https:"],
        "connect-src": ["'self'", "https:", "wss:"],
      },
    },
  }),
);

/**
 * CORS：多个域名用逗号分隔；开发环境默认 *，生产强制填具体域名。
 * credentials: true 给后续接入 Cookie / SameSite JWT 做准备。
 */
app.use(
  cors({
    origin:
      env.API_CORS_ORIGIN === "*"
        ? true
        : env.API_CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ["X-Request-Id", "X-Trace-Id"],
  }),
);

// 每个请求分配一个 trace id（后续链路排查用），通过 morgan token 打在 access log 里
app.use((req, _res, next) => {
  const id =
    (req.headers["x-request-id"] as string | undefined) ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  (req as unknown as { id: string }).id = id;
  next();
});

app.use(
  express.json({
    // highlights/bulk 一次可能塞 5~10MB highlights metadata，留点余量
    limit: "50mb",
  }),
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// =========================================================================
// 请求日志
// =========================================================================
morgan.token("id", (req) => (req as unknown as { id?: string }).id ?? "-");
app.use(
  morgan(
    env.isDevelopment
      ? ":id :method :url :status :res[content-length] - :response-time ms"
      : ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms',
    {
      stream: {
        write: (msg) => {
          const trimmed = msg.trimEnd();
          // 健康检查别刷 info 日志，debug 里看看够了
          if (trimmed.includes("/health") || trimmed.includes("GET / ")) {
            logger.debug(trimmed);
          } else {
            logger.info(trimmed);
          }
        },
      },
    },
  ),
);

// =========================================================================
// 路由
// =========================================================================

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "shoot-the-ball-api",
    version: "0.1.0",
    docs: `${env.API_PREFIX}/health`,
    env: env.APP_ENV,
  });
});

// 给 LB / 容器探活用的健康检查：不鉴权、不打 info log、越简单越好
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", ts: Date.now() });
});

app.use(env.API_PREFIX, apiV1Router);

// =========================================================================
// 错误处理（必须放在路由之后）
// =========================================================================
app.use(notFoundHandler);
app.use(errorHandler);

// 让未捕获的 Promise rejection / uncaughtException 走 pino 日志而不是 stderr
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught exception");
  process.exit(1);
});

// =========================================================================
// Server 生命周期
// =========================================================================
let server: ReturnType<typeof app.listen> | null = null;

export async function start(): Promise<void> {
  // 开发环境没配 DB 的话，先只起 HTTP（本地先测 health、SSE、schema 没问题）
  // 避免 `pnpm dev` 一上来就连不上 Postgres 直接崩。
  if (env.DATABASE_URL) {
    await connectDb();
  } else {
    logger.warn(
      "DATABASE_URL is empty; API will start but DB routes will fail at runtime.",
    );
  }

  server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      {
        host: env.API_HOST,
        port: env.API_PORT,
        env: env.NODE_ENV,
        bypassAuth: env.isDevelopment,
      },
      `API listening on http://${env.API_HOST}:${env.API_PORT}`,
    );
  });
}

export async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down API server...");
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  }
  await disconnectDb();
  logger.info("API server shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (require.main === module) {
  start().catch((err) => {
    logger.error(err, "Failed to start API server");
    process.exit(1);
  });
}

export { app };
