import dotenv from "dotenv";
import { cleanEnv, host, port, str, num, bool } from "envalid";

dotenv.config({ path: [".env.local", ".env", "../../.env"] });

// =========================================================================
// 环境变量 Schema
// =========================================================================
// 所有变量均由 envalid 强制校验；字符串类密钥/password 默认留空（开发环境允许不配置），
// 运行时真正调用到的模块（S3/JWT/Redis）会再针对空值抛错并打 warn/error log。
// 布尔开关默认关闭，防止开发时忘关带到生产。

const _schema = {
  NODE_ENV: str({
    choices: ["development", "test", "production", "staging"],
    default: "development",
  }),
  APP_ENV: str({
    choices: ["development", "test", "production", "staging"],
    default: "development",
  }),

  // ---------- HTTP Server ----------
  API_HOST: host({ default: "0.0.0.0" }),
  API_PORT: port({ default: 4000 }),
  API_PREFIX: str({ default: "/v1" }),
  /** 多个域名逗号分隔；* 代表允许任意 origin，仅开发环境 */
  API_CORS_ORIGIN: str({ default: "*" }),

  // ---------- Auth / JWT ----------
  /** 开发阶段可打开跳过登录；接入正式账号体系后必须关闭 */
  DEV_BYPASS_AUTH: bool({ default: false }),
  /** DEV_BYPASS_AUTH=true 时所有请求默认当作用户。记得 seed 里也要放一份对应 DB 行。 */
  DEV_FIXED_USER_ID: str({ default: "user_dev_000000000000001" }),
  DEV_FIXED_USER_EMAIL: str({ default: "dev@shoot-the-ball.local" }),
  DEV_FIXED_USER_NAME: str({ default: "Developer" }),

  JWT_SECRET: str({ default: "" }),
  JWT_EXPIRES_IN: str({ default: "7d" }),

  // ---------- Database ----------
  DATABASE_URL: str({ default: "" }),
  DIRECT_DATABASE_URL: str({ default: "" }),

  // ---------- Queue / Redis ----------
  REDIS_HOST: host({ default: "127.0.0.1" }),
  REDIS_PORT: port({ default: 6379 }),
  REDIS_PASSWORD: str({ default: "" }),
  REDIS_DB: num({ default: 0 }),
  REDIS_URL: str({ default: "" }),

  // ---------- Object Storage (S3 兼容 / R2) ----------
  STORAGE_PROVIDER: str({ choices: ["s3", "r2"], default: "s3" }),
  /** Cloudflare R2 必须填 endpoint；官方 AWS S3 留空。 */
  STORAGE_ENDPOINT: str({ default: "" }),
  STORAGE_REGION: str({ default: "ap-southeast-1" }),
  STORAGE_ACCESS_KEY_ID: str({ default: "" }),
  STORAGE_SECRET_ACCESS_KEY: str({ default: "" }),
  STORAGE_BUCKET_SOURCE: str({ default: "shoot-the-ball-source" }),
  STORAGE_BUCKET_EXPORTS: str({ default: "shoot-the-ball-exports" }),
  /** 预签名 PUT URL TTL（秒） */
  STORAGE_PRESIGNED_UPLOAD_TTL: num({ default: 1800 }),
  /** 预签名 GET URL TTL（秒） */
  STORAGE_PRESIGNED_DOWNLOAD_TTL: num({ default: 3600 }),

  // ---------- BullMQ ----------
  BULLMQ_CONCURRENCY: num({ default: 2 }),
  BULLMQ_PROCESSING_QUEUE: str({ default: "video-processing" }),
  BULLMQ_EXPORT_QUEUE: str({ default: "video-export" }),

  // ---------- SSE / 进度推送 ----------
  /** GET /jobs/:id/events 轮询 DB 间隔（毫秒）。1~2s 体验够顺滑。 */
  JOBS_SSE_POLL_INTERVAL_MS: num({ default: 1500 }),
  /** SSE 长连接最长存活时间，到点自动断开让前端自己重连，避免连接泄漏（毫秒）。 */
  JOBS_SSE_MAX_CONNECTION_MS: num({ default: 10 * 60 * 1000 }),

  // ---------- API ↔ ai-worker 内部回调 ----------
  /**
   * ai-worker PATCH /jobs/:id、POST /videos/:id/highlights/bulk 回 API 时必须带
   * X-Internal-Token 头 = 此处值。两端配置必须完全一致；本地没配会 warn 但能继续，
   * 生产没配等于完全不校验内部接口，必须强制配置。
   */
  API_INTERNAL_TOKEN: str({ default: "" }),
};

export const env = cleanEnv(process.env, _schema);

export type EnvSchemaKeys = keyof typeof _schema;
export type Env = typeof env;
