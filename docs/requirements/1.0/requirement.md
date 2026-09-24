# AI Basketball Highlight Generator — Product, Architecture & Implementation Plan

**版本**: v1.0 MVP（截至 2026-09-24 当前已落地代码对齐）
**更新日期**: 2026-09-24
**文档格式**: Markdown（`/docs/requirements/1.0/requirement.md` 为唯一真值；旧 `.pages` 文件仅供历史参考）

> 本文保留原 PRD 产品目标与 AI Pipeline，**根据当前代码库真实落地情况更新了客户端策略、技术栈、基础设施、API 表、分阶段完成度、本地开发与部署说明**。

---

## 1. 架构决策摘要

### 1.1 三层架构

| 层 | 角色 | 技术 / 语言 | 说明 |
|---|---|---|---|
| 用户体验层 | 上传视频、查看 AI 进度、审核 Highlights、导出/分享 | **Next.js 16 + Tailwind v4 Web Dashboard**（当前 MVP Phase 2A 已搭好，黄黑主题 + 拖拽上传）；Flutter 移动端（Phase 2B 规划中，非 MVP 阻塞） | MVP 先 Web 控制台落地验证，再扩展 iOS/Android |
| 业务控制层 | 认证、Project/Video/Highlight/Export、Signed URL、Job 编排、SSE 进度流 | **Node.js 22 + TypeScript + Express**；Prisma ORM + Zod + envalid + pino 结构化日志 + BullMQ 入队 | 已在 `services/api` 落地 Phase 1 骨架，链路：上传 → 入队 → AI 回调 → SSE → highlights 查询 |
| AI/视频计算层 | FFmpeg、目标检测、Tracking、进球判定、剪片段 | **Python 3.12 + Poetry 2**；YOLOv8（免费本地模型）+ OpenCV + SORT/Bot-SORT + PyTorch 可选 CUDA | 已在 `services/ai-worker` 落地真实可跑的 pipeline，`--local-video` 能剪真实进球 clips |

### 1.2 基础设施（默认云栈，MVP 免费额度可开跑）

- **数据库**: PostgreSQL（推荐 **Supabase**，本地用 `docker compose` 起 Postgres 16）
- **队列 / 内存缓存**: Redis（推荐 **Upstash**，本地 `docker compose` 起 Redis 7）
- **对象存储**: S3 兼容；MVP 首推 **Cloudflare R2**（零出口费，原生支持 Direct Upload 预签名 URL）；也可以 AWS S3 / MinIO
- **CDN 前端资源**: Cloudflare
- **部署目标**
  - Web Dashboard: Vercel
  - Node API: Fly.io 或自建 + Cloudflare Tunnel
  - AI Worker: MacBook 本地 GPU（M 系列）/ Lambda Cloud / 自托管 GPU 主机
- **认证**: MVP DEV 用 `DEV_BYPASS_AUTH=true` 挂默认 dev user；生产接入 **Supabase JWT**（或自建 JWT，schema 已保留）
- **内部对称密钥**: `API_INTERNAL_TOKEN` — AI Worker ↔ Node API 的内部写回接口鉴权（PATCH /jobs、POST /videos/:id/highlights/bulk 这类跨 user id 写操作必须带）

### 1.3 Monorepo 与构建工具

- **包管理器**: pnpm@9（workspace）+ turbo@2（缓存任务编排）
- **目录结构**: 见第 3 节
- **共享契约**: `packages/contracts`（OpenAPI YAML + TypeScript 类型，前后端 / Python 端共用）

---

## 2. 产品目标与 MVP 边界

### 2.1 核心闭环

> 1 小时固定机位篮球视频 → AI 自动识别进球 → 生成短片索引 → 用户 2-5 分钟审核 → 单条 / 合并导出分享。

### 2.2 MVP 支持

- 固定机位篮球训练、单挑、半场/全场比赛视频
- MP4 / MOV 主流格式
- 用户 UI 标注篮筐 ROI（`/videos/:id/calibration` 路由已留桩），Phase 6 可选球场 ROI
- **Coarse → Fine 两阶段视频分析**（已在 Python worker 实现）
- Shot Candidate（候选）与 Made Basket（真实进球）分离（已实现）
- 每条 Highlight 保存 `confidence`、`type`（MADE_BASKET 等）、`metadata`（模型版本、子项评分、ball/hoop/player bbox 等 Json 可扩展字段）
- UI 支持 Preview、Select、软 Delete、调整 Start/End 时间
- 支持 **Individual Export**（单条）与 **Merge Export**（按时间顺序拼接，FFmpeg concat）

### 2.3 MVP 明确不做

- 实时识别（直播流）
- 多机位 / 多角度拼接
- 专业级 Timeline Editor
- 球员身份识别 / 统计数据
- 社交 Feed、粉丝关注等网络效应功能
- 支付 / 订阅体系

---

## 3. Monorepo 目录

```
shoot-the-ball/
├── apps/
│   ├── web/                      # Next.js 16 Dashboard（MVP Phase 2A，当前用户端）
│   │   ├── app/                  # App Router 路由
│   │   ├── components/ui/        # shadcn/new-york 风格自建组件 (Button/Card/Progress)
│   │   ├── components/           # video-uploader / video-preview-dialog
│   │   └── globals.css           # Tailwind v4 黄黑主题变量
│   └── mobile/                   # Flutter 移动端（Phase 2B，目录已预留）
│
├── services/
│   ├── api/                      # Node.js Express + TS（Phase 1 Backend Skeleton ✅）
│   │   ├── src/
│   │   │   ├── config/           # env (envalid) + logger (pino)
│   │   │   ├── db/               # Prisma 单例
│   │   │   ├── storage/          # S3/R2 预签名 & HeadObject 封装
│   │   │   ├── jobs/             # BullMQ 队列 + updateJobStatus/Progress
│   │   │   ├── middleware/       # error 统一错误
│   │   │   ├── modules/          # auth / videos / jobs / highlights / exports / projects
│   │   │   └── main.ts           # helmet/cors/morgan/shutdown
│   │   ├── prisma/               # schema.prisma + seed.ts (dev user/project)
│   │   └── test/                 # vitest
│   │
│   └── ai-worker/                # Python AI + 视频计算 (Phase 0 Feasibility ✅)
│       ├── app/
│       │   ├── pipeline/         # prepare/coarse/fine/pipeline.py
│       │   ├── detectors/        # ball/hoop/player YOLOv8
│       │   ├── tracking/         # ball SORT/Bot-SORT
│       │   ├── events/           # possession/shot_candidate/made_basket/
│       │   │                    # confidence/deduplication/demo_highlights
│       │   ├── clips/            # highlight_generator.py
│       │   ├── ffmpeg/           # metadata/sampling/trim/concat
│       │   ├── config.py + logging_setup.py + types.py
│       │   └── worker.py         # RQ consumer，调 PATCH /jobs + POST highlights/bulk
│       └── tests/                # 单元 + 集成 + scripts (export_local_highlights.py)
│
├── packages/
│   └── contracts/                # OpenAPI shoot-the-ball.yaml + 共享 TS 类型
│
├── infra/
│   ├── compose/                  # dev-infra.yml / full-stack.yml
│   └── docker/                   # ai-worker.compose.yml / api.compose.yml / api-entrypoint.sh
│
├── docs/
│   ├── requirements/1.0/requirement.md   # 本文件（唯一真值）
│   ├── architecture/             # architecture-poster.png
│   ├── ai/                       # AI 本地运行指南 / 测试指南
│   └── api/                      # API 文档
│
├── .github/workflows/            # ci.yml / docker.yml / dependabot.yml
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json            # 共享 TS 配置
├── tsconfig.json                 # root references (services/api / apps/web / contracts)
├── README.md
└── package.json                  # pnpm --filter + turbo 统一脚本
```

> **原则**：Flutter / Node / Python / Next.js **绝不共享运行时依赖**。Monorepo 的价值是统一版本、文档、CI/CD、开发环境与接口契约，而非强行跨语言共享代码。

---

## 4. 系统总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ 用户体验层                                                            │
│  ┌──────────────────────┐      ┌──────────────────────┐             │
│  │ Next.js 16 Dashboard │      │ Flutter Mobile (TBD) │             │
│  │ (拖拽上传 + 进度条 +  │      │ (Phase 2B)           │             │
│  │  预览视频 + 审核导出) │      │                      │             │
│  └──────────┬───────────┘      └──────────┬───────────┘             │
│             │  HTTPS                     │                          │
│             │  JWT / DEV bypass          │                          │
└─────────────┼────────────────────────────┼──────────────────────────┘
              │                            │
┌─────────────▼────────────────────────────▼──────────────────────────┐
│ 业务控制层 (Node.js Express + TS 4000 端口)                            │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────────┐ │
│  │   认证     │  │ Projects   │  │  Videos    │  │ Highlights    │ │
│  │3 层策略👇  │  │            │  │ upload/..  │  │ 软删/写回     │ │
│  └────────────┘  └────────────┘  └────────────┘  └───────┬───────┘ │
│                                                          │         │
│  ┌────────────┐  ┌────────────┐  ┌───────────────────────▼───────┐ │
│  │   Jobs     │  │  Exports   │  │ SSE /jobs/:id/events 流推进度 │ │
│  │ BullMQ 入队│  │ (Phase 5)  │  │ (1.5s 轮询+25s 心跳+10min 断) │ │
│  └─────┬──────┘  └────────────┘  └───────────────────────────────┘ │
└────────┼────────────────────────────────────────────────────────────┘
         │
         │ Redis: video-processing 队列 (BullMQ Node ↔ RQ Python 共用)
         │
┌────────▼────────────────────────────────────────────────────────────┐
│ AI/视频计算层 (Python 3.12 Poetry)                                    │
│                                                                      │
│  worker.py 消费 job → _update_api_job(PATCH /jobs/:id 带 X-Internal │
│  -Token) → pipeline.py 8 阶段 → 写回 highlights → POST bulk(同上)   │
│                                                                      │
│  Prepare → Coarse → Candidate Detection → Fine Verification →      │
│  Confidence → Dedup → Clip Generation(索引) → Persist               │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ 对象存储 S3 兼容 (Cloudflare R2)
         │
┌────────▼────────────────────────────────────────────────────────────┐
│ 数据层                                                                 │
│                                                                      │
│  PostgreSQL (Supabase)          Redis (Upstash)                      │
│  User/Project/Video/             Job idempotency / 缓存中间结果       │
│  ProcessingJob/Highlight/       队列缓冲                              │
│  Export                                                                                                │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. 认证与安全（关键 MVP 决策）

### 5.1 三层 `requireAuth` 中间件（优先级从上到下）

```ts
// src/modules/auth/auth.middleware.ts
// 1) 内部 AI Worker 对称密钥 → 所有跨 userId 写操作必须用这种
Header: X-Internal-Token: <API_INTERNAL_TOKEN>
→ 挂 currentUser.id = "user_internal_ai_worker"

// 2) 本地开发 bypass → 不用先做登录注册
Env: DEV_BYPASS_AUTH=true, DEV_FIXED_USER_ID=...
→ 挂 seed.ts 预置 dev user (dev@shoot-the-ball.local)

// 3) 生产 JWT Bearer
Header: Authorization: Bearer <JWT>
→ 解析 userId / role
```

> **安全点**：`PATCH /v1/jobs/:id`、`POST /v1/videos/:id/highlights/bulk` 必须检测 `currentUser.id === 'user_internal_ai_worker'`，普通前端用户直接 **403 Forbidden**，避免越权篡改 Job 进度或跨用户写 Highlight。

### 5.2 传输与存储安全

- Helmet 默认 CSP：媒体 `media-src https: blob:`（允许 R2 预签名视频播放）
- CORS：`CORS_ORIGINS` 逗号分隔多域名白名单
- body：`express.json({ limit: '50mb' })`（为 highlights/bulk 保留余量）
- Direct Upload：原始视频不走 Node，避免 OOM 与带宽瓶颈
- `/videos/:id/complete` 阶段 **必须 HeadObject 校验**：客户端上报的 sizeBytes 不可信，**以 R2/S3 真实 obj.Size 落库**
- 对象存储名：`videos/<projectId>/<ISO>-<rand6>-<safeFilename>`，扩展名白名单 `mp4|mov|m4v|mkv|webm|avi`
- 所有 Signed URL 短期有效（上传 1h、下载 1h）

---

## 6. 数据模型（Prisma schema 为真值，此处仅关键字段摘要）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `User` | id, email, name, avatar, role(USER/ADMIN), createdAt | Supabase JWT uid 对齐；dev seed 预置 `user_dev_000000000000001` |
| `Project` | id, userId(PK→User), name, description, createdAt | MVP 默认 seed 一个 `proj-dev-default-001`，开发 bypass 模式直接用 |
| `Video` | id, projectId, userId, title, status(UPLOADING/UPLOADED/CALIBRATED/PROCESSING/PROCESSED/FAILED), **storageKey, sourceBucket**, durationSec, width, height, fps, sizeBytes, **calibration**(Json: hoopROI / courtROI 预留), metadata | storageKey 完整 R2 key；Direct Upload 不存原文件名路径 |
| `ProcessingJob` | id, videoId, projectId, userId, status(UPLADED→PREPARING→DETECTING→VERIFYING→GENERATING_CLIPS→READY/FAILED), stage, progress(0-1 小数), **errorMessage**, pipeline, model, startedAt, finishedAt | 与 BullMQ jobId **严格相同**，幂等；Python 端每个阶段调 PATCH 写回 |
| `Highlight` | id, videoId, processingJobId, userId, startTimeSec, endTimeSec, eventTimeSec, **confidence(0-1 小数)**, type(MADE_BASKET/ASSIST/STEAL/…), thumbnailStorageKey, **clipStorageKey**, metadata(Json 模型子评分/bbox), userStatus(PENDING/SELECTED/DELETED), **deleted(软删 bool)**, userEditedStart, userEditedEnd, userNote | **软删**：`deleted=true` 不物理删，原始视频永不删 |
| `Export` | id, userId, projectId, type(INDIVIDUAL/MERGE), highlightIds[], status(PENDING/PROCESSING/READY/FAILED), storageKey, downloadUrlExpiresAt, sizeBytes | 下载签短期名 URL 返回给前端 |

> 所有表含 `createdAt / updatedAt`；所有字符串主键使用 `cuid()` 或 `uuid()`，由 Prisma 管理。

---

## 7. API 设计（按 services/api 已落地，完整对齐当前代码）

### 7.1 路由总表

| 方法 | 路径 | 权限 | 说明 | Phase 状态 |
|---|---|---|---|---|
| GET | `/` | 公开 | 版本页（commit hash / 服务名） | ✅ |
| GET | `/healthz` | 公开 | LB 健康检查，pino 打 debug 不刷 info | ✅ |
| GET | `/v1/health` | 公开 | 依赖（Prisma ping）健康检查 | ✅ |
| **POST** | `/v1/videos/upload-session` | 登录用户 | 生成 R2 PUT 预签名 URL，创建 Video(UPLOADING) | ✅ |
| **POST** | `/v1/videos/:id/complete` | 资源属主 | HeadObject 校验真实文件，写 metadata + UPLOADED | ✅ |
| POST | `/v1/videos/:id/calibration` | 资源属主 | 保存篮筐/球场 ROI（空桩，Phase 6 实装） | 🚧 空桩 |
| **POST** | `/v1/videos/:id/process` | 资源属主 | 状态机校验 UPLOADED/FAILED 才能重启 → BullMQ video-processing → 返回 202 + jobId（**幂等**） | ✅ |
| **POST** | `/v1/videos/:id/highlights/bulk` | 仅 internal | **事务**：先软删 `deleted=true`，再 `createMany(skipDuplicates)` 写入 Highlights | ✅（内部） |
| GET | `/v1/videos/:id/highlights` | 资源属主 | eventTime asc，默认 `deleted=false` | ✅ |
| GET | `/v1/videos/:id` | 资源属主 | include processingJob + 下载 source 的 presigned `downloadUrl` | ✅ |
| GET | `/v1/jobs/:id` | 资源属主 | ProcessingJob 详情 | ✅ |
| **GET** | `/v1/jobs/:id/events` | 资源属主 | SSE 文本流，见 §7.3 事件列表 | ✅ |
| **PATCH** | `/v1/jobs/:id` | 仅 internal | AI Worker 写回 status/progress/stage/errorMessage，用户侧 403 | ✅（内部） |
| POST | `/v1/projects` | 登录用户 | 创建 Project | 🚧 空桩 |
| GET | `/v1/projects/:id` | 属主 | Project 详情 + 视频列表 | 🚧 空桩 |
| POST | `/v1/auth/register` | 公开 | JWT 注册（生产才开） | 🚧 空桩 |
| POST | `/v1/auth/login` | 公开 | JWT 登录（生产才开） | 🚧 空桩 |
| PATCH | `/v1/highlights/:id` | 属主 | 用户改 start/end 或 SELECTED/DELETED 状态（软删） | 🚧 空桩 |
| DELETE | `/v1/highlights/:id` | 属主 | 软删 `deleted=true` | 🚧 空桩 |
| POST | `/v1/exports` | 属主 | BullMQ exports 队列 | 🚧 空桩入队 |
| GET | `/v1/exports/:id` | 属主 | 导出详情 + presigned downloadUrl | 🚧 空桩 |

### 7.2 上传全链路时序（MVP 已可跑）

```
 Client (Dashboard)                 Node API (services/api)            Cloudflare R2
        │                                   │                              │
        │ 1) POST /videos/upload-session    │                              │
        │  (projectId, filename, size, mime)│                              │
        ├──────────────────────────────────►│                              │
        │                                   │ 2) Video(UPLOADING) +        │
        │                                   │    storageKey = videos/<pid>/│
        │                                   │    <ISO>-<rand6>-<safeName>  │
        │                                   │                              │
        │   {videoId, uploadUrl, storageKey, fields...}                    │
        │◄──────────────────────────────────┤ 3) createPresignedUpload PUT │
        │                                   │◄─────────────────────────────┤
        │                                   │                              │
        │ 4) PUT uploadUrl (原始二进制,不经过Node)                            │
        ├────────────────────────────────────────────────────────────────►│
        │                                   │                              │ OK 200
        │◄────────────────────────────────────────────────────────────────┤
        │                                   │                              │
        │ 5) POST /videos/:id/complete      │                              │
        │  (durationSec, fps, w, h, mime)  │                              │
        ├──────────────────────────────────►│                              │
        │                                   │ 6) headObject(source, key)   │
        │                                   ├─────────────────────────────►│
        │                                   │         Object{Size, ETag..} │
        │                                   │◄─────────────────────────────┤
        │                                   │                              │
        │                    Video UPLOADED, sizeBytes=真实 obj.Size      │
        │◄──────────────────────────────────┤                              │
        │                                   │                              │
        │ 7) POST /videos/:id/process       │                              │
        ├──────────────────────────────────►│                              │
        │                                   │ 8) Prisma: createProcessingJob│
        │                                   │    + BullMQ video-processing  │
        │                                   │    jobId = ProcessingJob.id  │
        │                                   │                              │
        │  202 {jobId, status}              │                              │
        │◄──────────────────────────────────┤                              │
        │                                   │                              │
        │ 9) GET /jobs/:id/events (SSE 长连)│                              │
        ├──────────────────────────────────►┤                              │
        │ ◄─event: progress/stage─          │                              │
        │ ◄─event: completed/failed─       │                              │
        │                                   │                              │
        │ 10) GET /videos/:id/highlights    │                              │
        ├──────────────────────────────────►┤ 读 Prisma Highlight 软删≠true│
        │◄──────────────────────────────────┤                              │
```

### 7.3 SSE 事件协议（`text/event-stream`）

```
retry: 3000

# 心跳（25s 一次，防止 nginx 60s idle 断连）
event: heartbeat
data: {"ts": 1770000000000}

# 进度变化（节流：只有 stage 或 progress 变化才推）
event: progress
data: {"jobId":"job_xxx","stage":"Detecting","progress":0.32}

event: completed
data: {"jobId":"job_xxx","status":"READY"}

event: failed
data: {"jobId":"job_xxx","status":"FAILED","errorMessage":"FFmpeg read failed"}

# 10 分钟到达最长连接，提示客户端重连
event: disconnected
data: {"jobId":"job_xxx","reason":"MAX_DURATION_REACHED"}
```

可调参数（envalid schema，见 `services/api/src/config/env.ts`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `JOBS_SSE_POLL_INTERVAL_MS` | 1500 | DB 轮询间隔 |
| `JOBS_SSE_HEARTBEAT_INTERVAL_MS` | 25000 | 心跳 |
| `JOBS_SSE_MAX_DURATION_MS` | 600000 | 最长连接 10 分钟 |

### 7.4 AI Worker → API 内部调用（必带 header）

- `PATCH /v1/jobs/:id` schema 字段：`status`（enum）/ `progress`（0-1）/ `stage` / `error_message` / `pipeline` / `model`
- `POST /v1/videos/:id/highlights/bulk` 每条 item：`startTimeSec, endTimeSec, eventTimeSec, confidence, type, metadata(Json nullable), clipStorageKey`
- 两端必须一致 Header：`X-Internal-Token: ${API_INTERNAL_TOKEN}`，两端 `.env.local` 的 token 必须字节级一致（services/api ↔ services/ai-worker）

---

## 8. Direct Upload & 视频生命周期

1. **客户端请求 upload-session** → 服务端做扩展名白名单校验
2. **生成 storageKey**：项目隔离 + 时间 + 随机 6 位 + safe basename
3. **客户端 PUT 到 R2/S3 预签名 URL**（60 分钟过期，16GB 单文件上限）
4. **complete 阶段**：必 HeadObject 校验文件存在，sizeBytes 取 S3 真值
5. **calibration**：客户端传 ROI polygon → Video.calibration Json 保留
6. **process**：只有 status=UPLOADED / FAILED 可以重启；ProcessingJob 存在 RUNNING 阶段时复用，避免重复入队
7. **长期归档**：原始视频 90 天后自动转低成本存储层（`LIFECYCLE_DAYS_SOURCE_ARCHIVE` 可配置）

---

## 9. AI Worker Pipeline（8 阶段，Python 端已全实现）

| Stage | 描述 | 写回 ProcessingJob.stage |
|---|---|---|
| 0 Prepare | 从 R2/S3 读取/流化；FFmpeg metadata；校验可读性 | `Preparing` |
| 1 Coarse Sampling | 低 FPS 抽帧，优先关注 hoop ROI（calibration 有值时） | `Preparing` → `Detecting` |
| 2 Candidate Detection | 检测 player/ball/hoop + Ball tracking | `Detecting` |
| 3 Shot Candidate | possession / ball motion / trajectory / hoop proximity → 候选窗口 | `Detecting` |
| 4 Fine Verification | 只对候选窗口提采样率，轨迹+篮筐交互+向下离开+temporal 一致性 → Made Basket | `Verifying` |
| 5 Confidence | 分项评分 + 综合 confidence，全部写 metadata | `Verifying` |
| 6 Deduplication | 相邻/重叠候选窗口做 event clustering，一进球只一条 Highlight | `Verifying` |
| 7 Clip Generation | 生成索引（默认 eventTime 前 5s、后 3s）；**不立即成片**，导出时才 FFmpeg trim（降低存储成本） | `GeneratingClips` |
| 8 Persist | 写回 `/v1/videos/:id/highlights/bulk`；把 Job 改成 `READY` 或 `FAILED` | `Ready` / `Failed` |

> 每阶段结果都要持久化，以便 Worker 崩溃后重试 / 恢复，不重跑全流程。

---

## 10. 内部模块划分（Python ai-worker 已实现）

```
ai-worker/app/
├── pipeline/    prepare.py │ coarse.py │ fine.py │ pipeline.py
├── detectors/   player_detector.py │ ball_detector.py │ hoop_detector.py  （YOLOv8）
├── tracking/    ball_tracker.py   （SORT / Bot-SORT 可切换）
├── events/      possession.py │ shot_candidate.py │ made_basket.py
│                confidence.py │ deduplication.py │ demo_highlights.py
├── clips/       highlight_generator.py
├── ffmpeg/      metadata.py │ sampling.py │ trim.py │ concat.py
├── config.py  logging_setup.py  types.py
└── worker.py — RQ 消费者；回调 Node API 时加 X-Internal-Token
```

---

## 11. Queue 与 Job 状态机

```
UPLOADED → PREPARING → DETECTING → VERIFYING → GENERATING_CLIPS → READY → EXPORTING → EXPORTED
               │          │            │               │
               └──────────┴────────────┴───────────────┴──► FAILED  (任何阶段可失败)

FAILED ──Retry / Resume──► 重跑最近阶段（结果持久化可恢复）
```

### 队列策略

- 队列名统一：**`video-processing`**（Node BullMQ `add()` 与 Python RQ 消费共享同一 Redis key，互不冲突）
- BullMQ jobId **严格 = ProcessingJob.id**，避免重复创建 Job
- Python 端 `worker.py` 也可 `--local-video <path>` 直接本地跑，走独立 entry，不经 Redis（调试 AI 阶段常用）

---

## 12. Review 交互（Dashboard 端待对接真实 API）

- 顶部：Video 播放器 + 当前选中 Highlight 的 Start/End 范围
- 列表：缩略图、eventTime、start/end、confidence、userStatus（PENDING/SELECTED/DELETED）
- 操作：
  - 按 confidence 范围过滤 + 升降序
  - 单条播放前后拖动 `startTimeSec / endTimeSec`（PATCH `/v1/highlights/:id`）
  - **软 Delete**（`deleted=true`，不删原始视频、不删 Highlight 行以便重查）
  - 批量 Select → POST `/v1/exports`（INDIVIDUAL 或 MERGE）
- 导出 Ready → 展示 Signed Download URL → 浏览器下载 / 系统分享

---

## 13. Export 流程（路由空桩已留，Phase 5 实装）

1. Dashboard 选 1+ Highlights → POST `/v1/exports`
2. Node 创建 Export 记录 + BullMQ `exports` 队列（Python 或 Node Worker 消费都行，MVP 先 Node 调 ffmpeg wasm 或直接 spawn ffmpeg）
3. Individual Export：按 start/end 调 `ffmpeg trim`
4. Merge Export：按 eventTime 升序，`ffmpeg concat demuxer` 拼接
5. 输出上传到 R2 私有 bucket → Export 状态 READY + 返回 presigned downloadUrl（默认 1h）
6. 前端触发下载 / Web Share API 分享

---

## 14. Next.js Dashboard（Phase 2A 已搭好骨架）

- **路径**: `apps/web/`
- **版本**: Next.js 16 + React 19 + App Router
- **UI 栈**:
  - Tailwind CSS v4（`globals.css` 黄黑主题：主色 `bg-yellow-400` / 近黑 `bg-neutral-950` / 点缀琥珀）
  - 自建 shadcn/new-york 风格组件：Button / Card / Progress（`cn()` helper + class-variance-authority 风格）
  - 自定义组件：`VideoUploader`（拖拽上传 + 进度条）/ `VideoPreviewDialog`（视频预览）
- **首页 (app/page.tsx)**: 标题 "Shoot The Ball" + 一句话副标题 + Upload Card + Processing State + Highlight 结果空桩
- **开发脚本（根 package.json 已加）**
  - `pnpm dev:web` 起 3000 端口
  - `pnpm build:web` 验证 Next build（已通过）
- **MVP 对接路线**（下一步工作）：`apps/web` 内新建 `lib/api-client.ts`，按 §7 接口接真 API，替换当前纯 UI mock 数据；SSE 端用 `EventSource` 监听 jobs/:id/events，驱动 Progress 组件。

---

## 15. 本地开发环境

### 15.0 前置依赖

| 工具 | 最低版本 | 验证命令 |
|---|---|---|
| Node.js | 22 LTS | `node -v` |
| pnpm | 9.x | `pnpm -v` |
| Python | 3.12.x | `python3 --version` |
| Poetry | 2.x（新语法已适配 ai-worker/pyproject.toml）| `poetry --version` |
| FFmpeg | 5.0+（含 libx264/aac）| `ffmpeg -version` |
| Docker Engine | 24+ | `docker compose version` |

### 15.1 一键起基础设施

```bash
cd shoot-the-ball
cp .env.example .env.local        # 共享变量（可选）
cp services/api/.env.example services/api/.env.local
cp services/ai-worker/.env.example services/ai-worker/.env.local
# 填 services/api/.env.local 至少：DATABASE_URL / REDIS_URL / R2/S3 / API_INTERNAL_TOKEN / DEV_BYPASS_AUTH=true
docker compose up -d postgres redis minio    # MinIO 本地替代 R2（可选）
```

### 15.2 四个命令起全端

```bash
# Terminal 1 — API (4000)
pnpm --filter @shoot-the-ball/api db:generate && db:migrate && db:seed
pnpm dev:api        # 或 cd services/api && pnpm tsx watch src/main.ts

# Terminal 2 — Python AI worker (消费 Redis 队列)
pnpm dev:worker     # 或 cd services/ai-worker && poetry run python -m app.worker

# Terminal 2b — AI 调试（直接本地视频跑 pipeline，不经 Redis 不经 API）
cd services/ai-worker
poetry run python -m app.worker --local-video ../assets/testing-video.MP4 \
  --output-dir ./tmp_out --skip-upload

# Terminal 3 — Web Dashboard (3000)
pnpm dev:web
```

### 15.3 curl 手跑完整上传链路（来自 services/api README.md）

详见 [services/api/README.md](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/README.md) §6 "用 curl 手跑完整链路" 一键复制脚本。

---

## 16. 日志与可观测性

### 16.1 services/api 日志

- **结构化日志库**：`pino`（生产纯 JSON，开发 `pino-pretty` 色彩）
- 每个 handler 打标准事件名（pino 易于 Datadog/Loki 聚合）：
  - `videos.upload_session_created`
  - `videos.completed`（附带 obj.sizeBytes vs client.sizeBytes 对比）
  - `videos.process_enqueued`（jobId + videoId + 去重命中与否）
  - `jobs.patched_internal`（附带 stage / progress delta）
  - `videos.highlights_bulk_written`（软删数 + 插入数）
  - ERROR 级始终带 `err: { message, stack }`
- **Access log**：`morgan` 自定义 `:id` token，贯穿 `X-Request-Id`（Helmet 已注入 req.id）
- `/healthz` 打 debug 级，避免 LB 每 5s 刷 info 爆量。

### 16.2 ai-worker 日志

- `loguru` 结构化 JSON（生产）/ 彩色（开发）
- 每阶段结束打 `stage_duration_ms` 汇总，方便成本估算
- 异常自动记录 err 并调用 PATCH /jobs 写回 `error_message`

### 16.3 失败恢复 & 幂等

- ProcessingJob 阶段持久化：Python Worker 崩溃后，新 Worker 可从最近阶段 resume
- Highlights 写回 **事务软删旧 + createMany(skipDuplicates=true)** → Worker 重复写回也无副作用
- BullMQ jobId = ProcessingJob.id → Node 端重复调 `/process` 不会重复入队

---

## 17. 测试策略

| 层 | 范围 | 执行方式 |
|---|---|---|
| AI 评估 | 真实标注 fixed-cam 视频 → Recall / Precision / User Correction Rate | `tests/scripts/benchmark.py` + 人工标注 JSON fixtures（`tests/fixtures/annotations/_template.json`） |
| ai-worker 单元 | metadata/sampling/tracking/event clustering/FFmpeg trim&concat | `poetry run pytest -q` |
| ai-worker 集成 | pipeline 8 阶段串联，产出 Highlights JSON | `tests/test_pipeline_smoke.py` + `--local-video` |
| services/api | 签名 URL 生成 / 权限 / Job 状态机 / Zod 校验 / 重试逻辑 | `pnpm --filter @shoot-the-ball/api test`（vitest + supertest） |
| apps/web | Upload / Processing / Review / Export 端到端 Widget/Playwright | 待配置（Phase 3） |
| E2E | 上传 → Job → Highlights → Export（本地 docker-compose + fixtures 视频） | 待配置（Phase 4） |

---

## 18. 部署 & 生产建议

| 组件 | 推荐 | 备注 |
|---|---|---|
| apps/web | **Vercel** | 环境变量 `NEXT_PUBLIC_API_BASE_URL`；静态资源走 Cloudflare CDN |
| services/api | **Fly.io** + Cloudflare Tunnel 或自托管 | 健康检查 `/healthz` 挂 LB；最小实例 512MB，峰值需 1-2GB（与视频大小无关，因为 Direct Upload） |
| services/ai-worker | MacBook 本地（M 系列 Metal）/ Lambda Cloud A10 起步 / 自托管 GPU | 只需要网络通 Redis + R2 + API；不对外公开端口 |
| PostgreSQL | **Supabase** 或 Fly Postgres | 每日 PITR + 开启 pg_cron 清理软删历史 |
| Redis | **Upstash**（Serverless 按请求付费，本地起用 docker compose） | `video-processing` 队列 key |
| 对象存储 | **Cloudflare R2**（零出口费 MVP 首选） | 两个 bucket：`source` 原始视频（长留存）/ `exports` 剪辑结果（短 TTL 可删） |
| CI/CD | `.github/workflows/ci.yml` | pnpm install + tsc --noEmit + vitest + pytest；docker.yml 构建 API & Worker image 推 registry |

---

## 19. 分阶段实施进度（真实代码状态，2026-09-24）

| Phase | 名称 | 交付物 | 进度 |
|---|---|---|---|
| **0** | AI Feasibility | YOLO + Tracking + Made Basket 能真实从 1h 视频识别进球并输出 clips；`tests/scripts/export_local_highlights.py` 可用 | ✅ DONE |
| **1** | Backend Skeleton | Prisma schema + seed / Express API 上传链路 / BullMQ 入队 / SSE 进度 / 内部鉴权 / README & .env.example | ✅ DONE（ai-worker ↔ API header 对接留一步） |
| **2A** | Web Dashboard | Next.js 16 + Tailwind v4 + 黄黑主题 + 拖拽上传 + 进度条 + 预览 UI 骨架 | ✅ DONE（下一步接真 API） |
| **2B** | Flutter Mobile | `apps/mobile/` 目录预留，骨架（上传 + Processing + Review） | 🚫 TODO |
| **3** | 端到端链路 | Dashboard → API → Queue → Worker → API → Highlights 写回 → Dashboard SSE 驱动 | 🔄 IN PROGRESS（当前） |
| **4** | Review 完整 | PATCH /highlights / DELETE / confidence filter / 本地预览调整 | 🚫 TODO |
| **5** | Export | Individual & Merge FFmpeg trim/concat + 返回下载 URL + Web Share | 🚫 TODO（路由已空桩） |
| **6** | 精度 & 成本 | Calibration UI → 传 hoop/court ROI → Coarse 阶段利用；缓存中间检测结果；GPU/推理成本优化；Camera Profile 持久化 | 🚫 TODO（路由 `/calibration` 已空桩） |

---

## 20. 明确暂缓的工作（MVP 期间不碰，避免 Scope 爆炸）

- 不做复杂账号体系、支付、社交 Feed
- 不做专业级 Timeline Editor
- 不做球员身份识别 / 比赛技术统计
- 不把整段视频逐帧送昂贵视觉模型（Coarse→Fine 的关键）
- 不把 AI Worker 与 Node API 混在同一进程/容器部署
- 不为了 MVP 先做 Flutter（Dashboard 先验证核心循环）
- 不拍板 confidence 阈值（0.85/0.60 仅默认，Phase 6 用真实用户数据调）

---

## 21. 关键产品指标

| 指标 | 定义 | MVP 目标 |
|---|---|---|
| **Made Basket Recall** | 真实进球被 AI 发现的比例 | ≥ 0.85 |
| **Precision** | AI 生成 Highlight 中用户确认是进球的比例 | ≥ 0.70 |
| **User Correction Rate** | 用户 DELETE 或 PATCH 调整 start/end 的比例 | ≤ 0.30 |
| **Processing Cost / Hour** | 云 GPU + 存储 + 出口费 ÷ 输入视频时长 | 本地开发 ≈ 0；云目标 < $0.3 / h |
| **Processing Time / Hour** | 1h 视频真实处理墙钟时间 | M3 Pro ≤ 25 min / GPU ≤ 5 min |
| **Time Saved** | 传统人工剪辑时长 ÷ AI Review 时长 | ≥ 10x（1h → 5 min 以内） |

> **北极星指标**：用户是否从"几十分钟手工剪进球"降低到"2-5 分钟导出分享"。

---

## 22. 最终技术栈 & 架构原则

### 22.1 技术栈总览（截至 v1.0 MVP）

- 用户体验层：**Next.js 16 + React 19 + Tailwind v4 + shadcn 风格自建组件**；Flutter 后续
- 业务控制层：**Node 22 + TypeScript 5 + Express 4 + Zod + envalid + Prisma 5 + BullMQ 5 + ioredis + pino + morgan + helmet**
- AI/视频层：**Python 3.12 + Poetry 2 + YOLOv8 + OpenCV + SORT/Bot-SORT + FFmpeg 5 + loguru + Redis RQ**
- 基础设施：**Supabase PostgreSQL / Upstash Redis / Cloudflare R2 & CDN / Vercel + Fly.io / MacBook M-Series 或 Lambda Cloud GPU**
- 构建 & Monorepo：**pnpm 9 + turbo 2 + Prisma Migrate + Docker Compose + GitHub Actions**

### 22.2 架构原则

1. **分层解耦**：Dashboard 是体验层；Node API 是业务控制层；Python Worker 是 AI/视频计算层。绝不把 AI 塞进 Node，绝不把业务逻辑塞进 Python。
2. **原始视频优先 Direct Upload**：永远不让大二进制流过 Node，避免 OOM 与带宽成本。
3. **所有长耗时全异步**：上传完成 / Processing / Export 全部 Job 化，客户端靠 SSE（或 polling）拿进度。
4. **AI 找候选，人拍板**：永远保留 Human-in-the-loop Review 流程，不直接输出给用户"最终成品"。
5. **AI Provider 隔离**：detector / tracker / verifier 全部接口化，方便后续替换 YOLO 为自训练模型 / 云端推理 API。
6. **中间结果持久化**：所有阶段产出可重试、可恢复、可复用，失败不重跑全流程。
7. **先证明核心闭环成立**："1h 视频 → 稳定找进球 → 用户几分钟审核" 成立后，再扩大功能到 Flutter、精度优化、多机位、商业化。

---

*End of Architecture & Implementation Plan (v1.0 MVP Markdown). Previous `.pages` document is deprecated.*
