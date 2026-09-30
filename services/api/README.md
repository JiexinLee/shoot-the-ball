# Shoot The Ball · API (Node.js / Express / TypeScript)

> **AI 篮球高光剪辑 · 后端控制层服务。**
> 职责：认证授权、项目/视频/highlights/export 业务、对象存储签名 URL、任务（Job）状态机 & 队列入队、SSE 进度推送、Python AI Worker 的内部回调。

本 README 只关心「**上传 → AI 分析 → 拿结果**」这第一阶段的核心链路。
其它模块（auth 完善 / projects / exports / review 交互等）按 requirement.md 第 17 节分阶段实施，后续 README 会跟进。

---

## 🎯 当前阶段已实现的接口

| Method | Path                             | 说明                                                                                      | 调用方      |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| POST   | `/v1/videos/upload-session`      | 创建视频记录 + 返回 PUT 预签名上传 URL（**Direct Upload**）                               | 前端/客户端 |
| POST   | `/v1/videos/:id/complete`        | 通知服务端文件已传完 → HeadObject 校验 → 写 metadata → `UPLOADED`                         | 前端/客户端 |
| POST   | `/v1/videos/:id/calibration`     | 保存用户框的 hoop/court ROI（桩实现）                                                     | 前端/客户端 |
| POST   | `/v1/videos/:id/process`         | 建 ProcessingJob + 入 BullMQ 队列 → 返回 jobId（Python Worker 消费）                      | 前端/客户端 |
| GET    | `/v1/videos/:id`                 | 视频详情 + 当前 job 状态 + 源视频临时下载签名 URL                                         | 前端/客户端 |
| GET    | `/v1/videos/:id/highlights`      | 取 highlights 列表（按 eventTime 升序）                                                   | 前端/客户端 |
| POST   | `/v1/videos/:id/highlights/bulk` | **内部接口**：AI Worker 把识别结果批量写回 DB（X-Internal-Token 校验）                    | ai-worker   |
| GET    | `/v1/jobs/:id`                   | 一次性查任务状态                                                                          | 前端/客户端 |
| GET    | `/v1/jobs/:id/events`            | **SSE 长连接**：每 1.5s 轮询 DB 推 `progress` / `completed` / `failed` / `heartbeat` 事件 | 前端/客户端 |
| PATCH  | `/v1/jobs/:id`                   | **内部接口**：AI Worker 实时回写 stage/progress                                           | ai-worker   |
| GET    | `/healthz`                       | K8s/LB 探活（无鉴权、极简）                                                               | 运维        |
| GET    | `/v1/health`                     | 业务健康检查（已在 routes/index.ts 里）                                                   | 通用        |

未实现的接口已在对应文件里打 `// TODO(...)` 注释。

---

## 🚀 本地开发（5 分钟跑通）

### 0. 前置依赖

- **Node.js ≥ 20**、**pnpm ≥ 9**
- **可选**：PostgreSQL（Supabase / 本地 Docker 都行，不填 `DATABASE_URL` 也能起 API，只是涉及 DB 的路由会运行时报错）
- **可选**：Redis（跑队列/worker 时需要，测 HTTP schema 不用）
- **可选**：Cloudflare R2 / S3 / MinIO 任一 S3 兼容对象存储（没配则预签名 URL 在运行时失败）

### 1. 安装依赖

```bash
cd shoot-the-ball
pnpm install            # 整个 monorepo 装
# 或只装 api：
pnpm --filter @shoot-the-ball/api install
```

### 2. 写本地环境变量

```bash
cd services/api
cp .env.example .env.local
# 然后打开 .env.local 按注释填
```

本地调试最舒服的配置：

```dotenv
# .env.local
NODE_ENV=development
APP_ENV=development

API_PORT=4321
API_HOST=127.0.0.1
API_PREFIX=/v1
API_CORS_ORIGIN=*    # 开发用 *，生产要写具体域名

# ====== 关键：本地不开账号体系，直接绕过 JWT ======
DEV_BYPASS_AUTH=true
DEV_FIXED_USER_ID=user_dev_000000000000001
DEV_FIXED_USER_EMAIL=dev@shoot-the-ball.local
DEV_FIXED_USER_NAME=Developer

# ====== Postgres（可以先用 Supabase 免费层） ======
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/shoot_the_ball?schema=public

# ====== Redis（Upstash 免费层也行） ======
# REDIS_URL=redis://....
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# ====== S3 兼容存储（R2 推荐） ======
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://<your-id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_ACCESS_KEY_ID=xxx
STORAGE_SECRET_ACCESS_KEY=xxx
STORAGE_BUCKET_SOURCE=shoot-the-ball-source
STORAGE_BUCKET_EXPORTS=shoot-the-ball-exports

# ====== 内部通信 Token（ai-worker <-> API 共享） ======
API_INTERNAL_TOKEN=make-something-long-random-like-this-one

# ====== SSE 进度推送 ======
JOBS_SSE_POLL_INTERVAL_MS=1500     # 1.5s 推一次，体验够顺滑
JOBS_SSE_MAX_CONNECTION_MS=600000  # 10 分钟强制断开，让前端自己重连
```

### 3. 初始化 DB + 启动 API

```bash
# 在 services/api 下
pnpm db:generate       # Prisma generate（第一次 & 每次改 schema 后）
pnpm db:migrate        # 跑迁移
pnpm db:seed           # 可选：塞一个默认 Project + dev 用户（没有也能跑，自己先 POST /v1/projects 建一个）

pnpm dev               # tsx watch 热更新
```

默认监听 `http://127.0.0.1:4321`。

快速验活：

```bash
curl -s http://127.0.0.1:4321/healthz
# 期望：{"status":"ok","ts":...}
```

---

## 🔗 上传 → AI 分析 链路时序图

```
 客户端 (Flutter/Web)               API (4321)                 BullMQ/Redis               ai-worker (Python)           S3/R2
──────────────────────        ────────────────────        ──────────────────         ──────────────────────        ────────
       │                            │                           │                           │                        │
       │ ① POST /v1/projects        │                           │                           │                        │
       │───────────────────────────►│ create Project + return id│                           │                        │
       │◄───────────────────────────│ { project }               │                           │                        │
       │                            │                           │                           │                        │
       │ ② POST /videos/upload-session (projectId,filename,..) │                           │                        │
       │───────────────────────────►│                           │                           │                        │
       │                            │ prisma.video.create(UPLOADING)                      │                        │
       │                            │ createPresignedUpload(key, contentType, size) ────────────────────────────────►│
       │                            │◄─────────────────────────────────────── { PUT signedURL }                       │
       │◄───────────────────────────│ { videoId, uploadUrl, storageKey }    │                           │
       │                            │                           │                           │                        │
       │ ③ PUT uploadUrl (body=视频)│                           │                           │                        │
       │───────────────────────────────────────────────────────────────────────────────────────────────────────────────►│ multipart 直传，不经过 API
       │◄───────────────────────────────────────────────────────────────────────────────────────────────────────────────│ 200 OK
       │                            │                           │                           │                        │
       │ ④ POST /videos/:id/complete (duration,width,height,fps) │                         │                        │
       │───────────────────────────►│                           │                           │                        │
       │                            │ headObject(key) ──────────────────────────────────────────────────────────────►│
       │                            │◄─────────────────────────────────────── { sizeBytes, etag }                     │
       │                            │ prisma.video.update → UPLOADED          │                           │
       │◄───────────────────────────│ { video }                 │                           │                        │
       │                            │                           │                           │                        │
       │ ⑤ POST /videos/:id/process│                           │                           │                        │
       │───────────────────────────►│ enqueueProcessingJob()   │                           │                        │
       │                            │──────────────────────────► create ProcessingJob      │                        │
       │◄───────────────────────────│ { jobId }                 │ BullMQ add(process-video) │                        │
       │                            │                           │──────────────────────────►│ process_video(payload) │
       │                            │                           │                           │  pipeline.run(ctx)      │
       │ ⑥ GET /jobs/:id/events     │                           │                           │  for each stage:        │
       │ (SSE EventSource)          │ setInterval 查 DB 推进度  │                           │   PATCH /jobs/:id       │
       │───────────────────────────►│ stage/progress 变化时写： │◄──────────────────────────│──────────────────────────
       │◄─ event: progress ─────────│ (progress, stage)        │                           │ { stage, progress }    │
       │◄─ event: progress ─────────│ ...                       │                           │                        │
       │◄─ event: heartbeat ────────│ 25s 心跳                  │                           │ 生成 highlights         │
       │                            │                           │                           │ POST /:id/highlights/bulk│
       │                            │                           │     (X-Internal-Token)◄──│──────────────────────────
       │◄─ event: completed ────────│ prisma job READY          │                           │                        │
       │                            │                           │                           │                        │
       │ ⑦ GET /videos/:id/highlights                         │                           │                        │
       │───────────────────────────►│ prisma.highlight.findMany │                           │                        │
       │◄───────────────────────────│ { highlights }            │                           │                        │
```

---

## 🧪 用 curl 手跑完整链路（开发模式，DEV_BYPASS_AUTH=true）

先准备一个叫 `game.mp4` 的小视频。下面脚本里的 `PROJECT_ID` 先用 `POST /v1/projects` 建一个。

```bash
API=http://127.0.0.1:4321/v1

# 0. 建一个 Project（没建过项目才需要）
PROJECT_ID=$(curl -s -X POST $API/projects -H 'Content-Type: application/json' \
  -d '{"name":"My First Game"}' | jq -r .project.id)
echo "PROJECT_ID=$PROJECT_ID"

# 1. upload session
FILE=/tmp/game.mp4
MIME=$(file -b --mime-type "$FILE")
SIZE=$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE")
SESSION=$(curl -s -X POST $API/videos/upload-session \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PROJECT_ID\",\"filename\":\"game.mp4\",\"contentType\":\"$MIME\",\"size\":$SIZE}")
VIDEO_ID=$(echo "$SESSION" | jq -r .videoId)
UPLOAD_URL=$(echo "$SESSION" | jq -r .uploadUrl)
echo "VIDEO_ID=$VIDEO_ID UPLOAD_URL_LEN=${#UPLOAD_URL}"

# 2. 直传视频到 R2/S3
curl -sS -X PUT "$UPLOAD_URL" --data-binary @"$FILE" -H "Content-Type: $MIME" | head -c 80
echo

# 3. complete
curl -sS -X POST $API/videos/$VIDEO_ID/complete \
  -H 'Content-Type: application/json' \
  -d '{"duration":17.53,"width":1180,"height":2556,"fps":59.94}' | jq '.video | {id,status,sizeBytes,duration,sourceUrl}'

# 4. process → 入队 AI
RESP=$(curl -sS -X POST $API/videos/$VIDEO_ID/process)
JOB_ID=$(echo "$RESP" | jq -r .jobId)
echo "JOB_ID=$JOB_ID"

# 5. SSE 订阅进度（10s 内应该看到 progress 变化；没起 Redis/worker 就会一直 0% 直到 timeout）
curl -N -sS $API/jobs/$JOB_ID/events | head -n 30

# 6. 查 highlights（处理完 READY 再调）
curl -sS $API/videos/$VIDEO_ID/highlights | jq '.highlights | length'
```

---

## 🧱 代码分层架构（Domain-Driven 3-Layer）

每个业务 domain（`videos` / `projects` / `highlights` / `jobs` / `exports` / `auth`）在 `src/modules/<domain>/` 下按以下结构拆分，禁止把 handler / 业务逻辑 / SQL 写在同一个文件：

```
src/modules/videos/
├── videos.routes.ts              ← 汇总入口：Router() + requireAuth + 按顺序 register 所有 handlers（只干这个，<50 行）
├── videos.utils.ts               ← 纯函数 helper（共享给 service，不依赖 Express / Prisma）
├── handlers/                     ← 路由处理层
│   ├── createUploadSession.ts    ← POST /upload-session ：只做 zod 校验 → 调 service → 按 error.code 映射 HTTP 状态码
│   ├── completeUploadById.ts     ← POST /:id/complete
│   ├── calibrateVideoById.ts     ← POST /:id/calibration
│   ├── processVideoById.ts       ← POST /:id/process
│   ├── bulkWriteHighlightsById.ts← POST /:id/highlights/bulk（内部接口）
│   ├── getVideoHighlightsById.ts ← GET  /:id/highlights
│   └── getVideoById.ts           ← GET  /:id
├── services/                     ← 业务逻辑层（唯一允许编排"多步业务动作"的地方）
│   ├── upload.service.ts         ← createUploadSession + completeUpload；export ServiceResult<T>
│   ├── calibration.service.ts    ← saveCalibration
│   ├── processing.service.ts     ← startProcessing（Mock 分支 + BullMQ 分支；事务性写 processingJob + highlight）
│   ├── highlights.service.ts     ← bulkWriteHighlights + getVideoHighlights（权限：internal user vs owner）
│   └── videos.service.ts         ← getVideoById（详情 + 预签名下载 URL）
└── repositories/                 ← 数据访问层（只封装 Prisma 读写，绝对不出现 if/业务判断）
    ├── projects.repository.ts    ← findByIdAndUserId
    ├── videos.repository.ts      ← findById / findByIdAndUserId / findByIdWithProcessingJob / create / update
    ├── processingJobs.repository.ts ← findRunningJobByVideoId / create / update
    └── highlights.repository.ts  ← countByVideoId / listActiveByVideoId / softDeleteAndCreateMany / createInTransaction
```

### 依赖方向（单向，禁止反向）

```
 handlers → services → repositories → Prisma
    │           │            │
    │           └──────► videos.utils.ts（纯函数，零副作用）
    └── Express Request / Response 只在这里出现，绝不带到 service/repository
```

### 关键约束（硬规则）

| 层           | 可以直接 import                                                                              | 绝对禁止                                                  |
| ------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| handlers     | Router / Express types / `../services/*.service.ts` / zod schemas（从 service 拿）           | `import { prisma }` / 写业务 if / 拼 Prisma where         |
| services     | `../repositories/*.repository.ts` / storage / jobs / env / logger / zod（schema 定义在这里） | `import { prisma }` / `import type { Request, Response }` |
| repositories | `../../../db/prisma`（= prisma 单例） + Prisma generated types                               | 任何业务 if（"status === FAILED" 这种必须在 service 写）  |

### Service 返回协议：`ServiceResult<T>`

所有 `*.service.ts` 的公共方法返回 `Promise<ServiceResult<T>>`：

```ts
type ServiceResult<T> = { ok?: T; error?: { code: number; message: string } };
```

好处：

- handler 层无脑写 `if (result.error) return res.status(result.error.code).json(...)`，不再需要到处 try/catch
- 业务错误（404 / 409）在 service 层统一建模，将来切换到 tRPC / gRPC 也不用改 service
- 单元测试 service 时不需要 mock Express Response

---

## 🧯 安全/日志设计要点

| 主题          | 实现位置                              | 说明                                                                                                        |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 鉴权          | `modules/auth/auth.middleware.ts`     | 3 层：内部 X-Internal-Token → 开发 DEV_BYPASS_AUTH → 正常 JWT Bearer。优先级从高到低。                      |
| CORS          | `main.ts` cors()                      | 开发 `*`，生产逗号分隔白名单；暴露 X-Request-Id 头。                                                        |
| 安全响应头    | `main.ts` helmet()                    | CSP / X-Frame / HSTS / no-sniff / crossOriginResourcePolicy 等；媒体资源允许 `https:` 直连 R2/S3。          |
| body 大小限制 | `main.ts` express.json                | JSON 50MB、urlencoded 10MB（给 highlights/bulk 留余量），视频不会走 body。                                  |
| 请求链路 ID   | `main.ts` 中间件 + morgan `:id` token | 每个请求分配 `X-Request-Id`，access log 里能对应到 pino logger 上下文，排错时跨 Python/Node/前端能对齐 ID。 |
| 结构化日志    | `config/logger.ts` pino               | 开发 `pino-pretty` 彩色，生产纯 JSON，可直接喂 Datadog / BetterStack / CloudWatch。                         |
| SSE 断开保护  | `jobs.routes.ts`                      | 1.5s DB 轮询 + 25s 心跳 + 10 分钟 max-connection，避免内存/DB 连接泄漏。                                    |
| 参数校验      | 每个 router 里的 zod schema           | 所有输入严格校验：扩展名白名单、size 上限、数字范围。拒绝后返回 `400 { error, details }` 而不是模糊 500。   |
| 内部接口保护  | `PATCH /jobs/:id` 等                  | 仅允许 `user_internal_ai_worker` 调用；`highlights/bulk` 也区分 internal 调用权限。                         |

---

## 📝 已知 TODO / 后续 Phase 要做的

- **[Phase 2 Auth]**：把 DEV_BYPASS_AUTH 关了，接 Supabase Auth / NextAuth / JWT 真实账号体系；补注册登录接口。
- **[Phase 3 Storage]**：上传 >5GB 的视频要做 Multipart（预签名 POST / UploadPart），而不是单个 PUT。
- **[Phase 3 Worker]**：Python ai-worker 里的 `_update_api_job()` 改成带 `X-Internal-Token` 头，和 API 侧校验对应。
- **[Phase 4 Review]**：`GET /videos` 分页、调整 start/end 的 PATCH、批量 approve/reject。
- **[Phase 5 Export]**：Exports 路由的 SSE 进度推送 + 下载签名 URL（exports.routes.ts 目前已有基础实现）。
