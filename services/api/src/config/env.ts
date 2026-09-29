import dotenv from "dotenv";
import { cleanEnv, host, port, str, num, bool, makeValidator } from "envalid";

dotenv.config({ path: [".env.local", ".env", "../../.env"] });

// =========================================================================
// 自定义 Validator（关键修复点）
// =========================================================================
// envalid 内置的 host() / port() 强制非空校验：哪怕传空字符串也会报 "Invalid host/port"。
// 但我们优先级是 REDIS_URL 优先：配置了 REDIS_URL（如 Upstash）时，REDIS_HOST / REDIS_PORT
// 允许空值回退到 schema default。否则用户在根目录 .env 留了空 HOST/PORT 就会导致 API
// 启动瞬间炸 "Invalid environment variables"。下面用 makeValidator 给空值打桩回 undefined，
// 让 envalid 自己走 default 分支。
const hostOrEmpty = makeValidator<string>((input: string) => {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "127.0.0.1";
  // 复用 envalid 内置 host() 对非空值做格式校验（IP / domain / localhost）
  try {
    return cleanEnv({ _H: trimmed }, { _H: host() } as unknown as Record<
      string,
      never
    >)._H as string;
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
    throw new Error(`REDIS_HOST invalid: ${msg}`);
  }
});

const portOrEmpty = makeValidator<number>((input: string) => {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return 6379;
  try {
    return cleanEnv({ _P: trimmed }, { _P: port() } as unknown as Record<
      string,
      never
    >)._P as number;
  } catch (err) {
    const msg =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
    throw new Error(`REDIS_PORT invalid: ${msg}`);
  }
});

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
  API_PORT: port({ default: 4321 }),
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
  REDIS_HOST: hostOrEmpty(),
  REDIS_PORT: portOrEmpty(),
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
