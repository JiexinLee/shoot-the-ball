# 视频上传 → AI 分析 → SSE 进度推送：完整行为规范

> **文档版本**：1.0 (MVP Phase)  
> **适用模块**：`apps/web` (Next.js 前端) ↔ `services/api` (Node.js 后端) ↔ `services/ai-worker` (Python 推理服务) ↔ Cloudflare R2 / MinIO ↔ Redis  
> **Hard Constraints**：
> - 所有用户界面、API 文档、错误信息、日志输出均为**纯英文**系统
> - 视频上传必须使用 **预签名 URL Direct Upload** 方案，二进制流 **绝对不经过 API 服务中转**（节省带宽）
> - API ↔ AI Worker 内部通信必须携带 `X-Internal-Token` 自定义请求头（Hard Constraint，不走 JWT Bearer）
> - 视频处理进度推送必须使用 **SSE (Server-Sent Events)** 流式架构

---

## 1. 流程总览图

```mermaid
flowchart TD
    A[👤 用户拖拽或选中视频文件] --> B[📱 前端 probeVideo<br/>本地读 metadata]
    B --> C[1️⃣ POST /v1/videos/upload-session<br/>申请预签名 URL]
    C --> D[🗄️ API 写 Supabase DB<br/>status = UPLOADING]
    D --> E[2️⃣ ✉️ 前端 PUT 到预签名 URL<br/>直传 R2 / MinIO<br/>（完全不经过 API）]
    E --> F[3️⃣ POST /v1/videos/:id/complete<br/>通知 API 上传完成]
    F --> G[🔍 API 调 HeadObject<br/>**真实校验云端文件存在**<br/>⚠️ 绝不信任前端 size 参数]
    G --> H[🗄️ DB: status = UPLOADED]
    H --> I[4️⃣ POST /v1/videos/:id/process<br/>用户发起分析]
    I --> J[📮 API 入队 BullMQ → Redis<br/>ProcessingJob.status = PREPARING]
    J --> K[🐍 Python AI Worker BLPOP 弹出任务]
    K --> L[🧠 HighlightPipeline 4 阶段<br/>Prepare → Detect → Verify → Generate]
    L --> M[5️⃣ PATCH /v1/jobs/:id<br/>X-Internal-Token 鉴权<br/>每阶段 / 每 0.5% 回写进度]
    M --> N[6️⃣ GET /v1/jobs/:jobId/events<br/>SSE 长连接]
    N --> O[📡 API 每 1.5s 轮询 DB<br/>每 25s 心跳包]
    O --> P[🟢 PATCH READY + POST highlights/bulk<br/>写入精彩片段]
    P --> Q[✅ SSE 推送 completed 事件<br/>连接关闭，卡片变绿 Ready]
```

---

## 2. 调用时序表（端到端 10 步，含 HTTP 方法、Body、状态变化、关键校验）

| # | 触发方 | HTTP 端点 | 鉴权 | Body / Payload | 关键校验 & 状态机变化 | 返回值 / UI 表现 |
|---|---|---|---|---|---|---|
| 0 | **系统启动** | - | - | - | API 加载 Helmet/CORS，挂载 6 个 namespace routes；Worker 启动队列监听 | [main.ts](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/main.ts) |
| 1 | 👤 用户松手 | N/A（浏览器本地）| N/A | 视频 File 对象 | `document.createElement('video')` 读 `loadedmetadata`，拿到 **duration / width / height** | 卡片初始化，进度条 0% Pending |
| 2 | 📱 前端 | **`POST /v1/videos/upload-session`** | JWT / dev bypass fixed user | ```json<br/>{<br/>  "projectId": "proj-dev-default-001",<br/>  "filename": "game1.mp4",<br/>  "contentType": "video/mp4",<br/>  "size": 123456789<br/>} | ✅ 校验 extension 白名单<br/>✅ size ≤ 16GB (Zod 强校验)<br/>✅ projectId 必须属于当前 userId（防越权）<br/>✅ Prisma `video.create({status: UPLOADING})` | ```json<br/>{<br/>  "videoId": "cl_xxx",<br/>  "uploadUrl": "https://<r2-endpoint>/...?X-Amz-Signature=...",<br/>  "storageKey": "videos/<proj>/.../game1.mp4",<br/>  "uploadMethod": "PUT",<br/>  "uploadExpiresInSec": 900<br/>}<br/>``` 卡片状态：**Uploading 0%** |
| 3 | 📱 前端直连存储 | **`PUT <uploadUrl>`** | 预签名 URL SigV4 | 二进制 file 流（Content-Type 必须与申请时一致，否则 R2 403） | `xhr.upload.onprogress (loaded/total)` 实时驱动真实进度条；用户点击 ✕ → `AbortController.abort()` 中断 | 卡片进度条真实涨百分比 → 100% 时切下一阶段 |
| 4 | 📱 前端 | **`POST /v1/videos/:id/complete`** | JWT / dev bypass | ```json<br/>{<br/>  "duration": 7200.5,<br/>  "width": 1920,<br/>  "height": 1080<br/>}<br/>```（所有字段可选） | 🔴 **HARD SAFETY CHECK**：API 调 R2/MinIO `HeadObject` **真实检查文件是否存在于云端**；若 404 → 立即拒绝 409 "Object not found"（防止客户端伪造 complete 请求）<br/>✅ **`sizeBytes` 写入 DB 时用 HeadObject 返回的真实 `Content-Length`**，不用前端传的 size（防篡改）<br/>✅ status: `UPLOADING → UPLOADED` | 卡片切：**AI Processing 0%** |
| 5 | 📱 前端（自动 / 手动）| **`POST /v1/videos/:id/process`** | JWT / dev bypass | 空 Body | ✅ 仅允许 `status == UPLOADED \|\| FAILED` 入队；PROCESSING / PROCESSING 的直接 409 Conflict（防重复 Worker 浪费资源）<br/>✅ Prisma `processingJob.create({status: PREPARING, progress: 0})`<br/>✅ BullMQ 入队 Redis List `video-processing`，jobId = ProcessingJob.id（幂等去重）<br/>✅ 3 次指数退避重试（失败自动重跑） | ```json<br/>{<br/>  "jobId": "cl_xxx_<processingJobId>"<br/>}<br/>```前端存 jobId，下一步 SSE 订阅 |
| 6 | 🐍 Python AI Worker（常驻）| Redis BLPOP `video-processing` queue | N/A（内部 Redis 协议）| `{videoId, projectId, userId, storageKey}` | Worker `process_video()` 主循环：<br/>1. `_update_api_job(PREPARING, 0.02)` → 调 PATCH<br/>2. `s3.get_object(shoot-the-ball-source, storageKey)` → 下载源视频到 /tmp<br/>3. 4 阶段 pipeline.run(ctx)<br/>4. POST `/highlights/bulk` 批量写结果<br/>5. PATCH status=`READY` progress=1.0 | N/A（异步，在 Worker 进程内执行，终端打印 INFO 日志）|
| 7 | 🐍 Worker（每阶段每 0.5%） | **`PATCH /v1/jobs/:id`** | 🔐 **`X-Internal-Token` 自定义头**（不是 JWT！）| ```json<br/>{<br/>  "status": "DETECTING",<br/>  "progress": 0.15,<br/>  "stage": "Detecting ball (coarse pass 1/3)",<br/>  "pipelineVersion": "0.1.0"<br/>}<br/>``` | ✅ `X-Internal-Token !== API_INTERNAL_TOKEN → 403 Forbidden`（Hard Constraint）<br/>✅ 状态机强校验，只允许 PREPARING → DETECTING → VERIFYING → GENERATING → READY，不允许跳步 | 前端不可见；写入 DB ProcessingJob 表 progress/stage/status 字段 |
| 8 | 📱 前端 SSE 订阅 | **`GET /v1/jobs/:jobId/events`** | JWT / dev bypass + 只允许属主订阅他人 jobId 返回 403 | N/A（长连接） | API 侧：<br/>✅ Content-Type: `text/event-stream; charset=utf-8`<br/>✅ Cache-Control: `no-cache, no-transform`<br/>✅ X-Accel-Buffering: no（禁止 nginx 缓冲 SSE 包）<br/>✅ `setInterval(1.5s) → Prisma findProcessingJob` 轮询 DB<br/>✅ 节流：仅 progress 变化 ≥ 0.5% 才推事件<br/>✅ `setInterval(25s) → heartbeat` 包防 60s 反向代理断连<br/>✅ 10min 硬超时 → res.end() 防僵尸连接<br/>✅ `req.on('close')` 清两个 interval（防内存泄漏）<br/>✅ 读到 READY → `event: completed`；读到 FAILED → `event: failed` + 错误信息 | **SSE 事件流**：<br/>```<br/>event: progress<br/>data: {"jobId":"...", "stage":"Verifying", "progress":0.42}<br/><br/>event: heartbeat<br/>data: {"ts":1727131234567}<br/><br/>event: completed<br/>data: {"jobId":"...", "status":"READY"}<br/>``` |
| 9 | 🐍 Worker（pipeline 结束）| **`POST /v1/videos/:id/highlights/bulk`** | 🔐 `X-Internal-Token` | 最多 5000 条 highlights（startTime/endTime/type/clipStorageKey）| 💣 Prisma `$transaction` 原子：<br/>1. 软删该 videoId 所有旧 highlights（同视频重跑 pipeline 不会出现重复条目）<br/>2. `createMany({data, skipDuplicates: true})` 一次性批量 INSERT（比 for 循环快 100 倍，避免 N+1）<br/>3. ProcessingJob.status = `READY` | DB：写入 clips，前端 SSE 下一个 1.5s 周期读到 READY |
| 10 | 📱 前端 SSE 回调 | N/A | N/A | N/A | `event: progress` → 进度条涨 + stage 文案提示<br/>`event: completed` → 卡片 ✅ 绿色 Ready<br/>`event: failed` → 卡片 ❌ 红色 Failed + `error` 字段显示给用户 | 卡片最终状态 |

---

## 3. 状态机详细说明（避免重复入队 / 数据竞态）

### 3.1 Video.status 状态机

```mermaid
stateDiagram-v2
    [*] --> UPLOADING : POST upload-session 写 DB
    UPLOADING --> UPLOADED : POST complete ✓ HeadObject 校验通过
    UPLOADING --> FAILED : ❌ 预签名 URL 过期 / HeadObject 404 太久
    UPLOADED --> PROCESSING : POST process (入队成功瞬间)
    PROCESSING --> READY : Worker PATCH job status=READY
    PROCESSING --> FAILED : Worker PATCH 10min 超时 / YOLO crash
    FAILED --> PROCESSING : 用户再次点击 Retry POST process
    READY --> EXPORTED : 某条 clip 成功生成导出任务
```

### 3.2 ProcessingJob.status 状态机（Worker 专属，与 Video 状态机解耦）

| 状态 | 触发时机 | progress 范围 |
|---|---|---|
| `PENDING` | DB 刚 create，还没入 BullMQ | 0 |
| `PREPARING` | Worker 刚从 Redis BLPOP 弹出任务，开始 R2 下载源视频 | 0 ~ 0.05 |
| `DETECTING` | Coarse + Fine 两阶段 YOLO 推理中 | 0.05 ~ 0.85 |
| `VERIFYING` | 轨迹 / 篮球抛物线 / 得分验证 + NMS 去重 | 0.85 ~ 0.95 |
| `GENERATING_CLIPS` | ffmpeg -ss/-t 切 3P/FT/dunk 等 clip，上传导出桶 | 0.95 ~ 0.99 |
| `READY` | highlights bulk 写入成功 | 1.0 |
| `FAILED` | 任意阶段异常，worker `_update_api_job(FAILED, error_message=xxx)` | 0 ~ 1.0 |

---

## 4. 关键安全 & 省钱决策索引（MVP 架构核心）

> 💡 每一条都是 MVP 阶段的成本/安全分水岭，不要随意改动

| # | 决策 | 在哪里实现 | 为什么这样做 |
|---|---|---|---|
| 4.1 | 预签名 URL Direct Upload（视频不走 API 中转）| [videos.routes.ts L60-L69](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L60-L69) | **省钱关键**：10GB 视频走 API 中转 → API 出口 10GB + R2 入口 10GB → $1.5；直连 R2 → $0 出口费 |
| 4.2 | complete 阶段 **必须 HeadObject 真实校验云端文件**，不信客户端 size | [videos.routes.ts L205-L223](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L205-L223) | **Lesson Learned 安全硬约束**：否则恶意用户直接 curl `/complete` 就能造一条假记录，占用 DB storage quota |
| 4.3 | `sizeBytes` 写 DB 用 HeadObject 返回的真实 `Content-Length` | [videos.routes.ts L218-L221](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L218-L221) | 防止前端 JS 被改，把 10GB 说自己是 10MB 绕过 storage 配额 |
| 4.4 | PATCH /jobs & POST highlights/bulk 必须走 **`X-Internal-Token`**，不是 JWT | [jobs.routes.ts L226-L234](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L226-L234) | Hard Constraint：JWT 是面向用户的短 TTL token，Worker 是内部服务，用独立长 token + 自定义头，被泄露也无法冒充用户调 /me /projects 等接口 |
| 4.5 | SSE 25s 心跳包 + 10min 硬断 | [jobs.routes.ts L107-L112](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L107-L112) | **SSE 性能硬约束**：反向代理/Cloudflare 默认 60s 空闲没数据就掐断长连接，25s 心跳保活；10min 硬断防用户关浏览器后连接占内存 |
| 4.6 | highlights bulk 事务两阶段：先软删旧 → 再 createMany 新 | [videos.routes.ts L376-L392](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L376-L392) | 同一视频重跑 pipeline 时，不会出现 "同一个 3P 进球两条记录" 的数据重复；createMany 比 for 循环单条 insert 快约 100 倍 |
| 4.7 | POST process 仅允许 UPLOADED / FAILED 入队 | [videos.routes.ts L285-L290](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L285-L290) | 防止用户快速连点两次按钮，导致同一视频同时入队 2 个 Worker 吃 GPU 配额 x2 |
| 4.8 | SSE 节流：progress 变化 ≥ 0.5% 才推事件 | [jobs.routes.ts L124-L128](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L124-L128) | 1.5s 轮询 1 次，10min 内最多 40000 次事件；加上节流，实际推送 ~200 次 = 前端 CPU rerender 次数 × 200 减少 |

---

## 5. 错误码速查表（前端 UX 对接必备）

| HTTP Code | 场景 | 用户文案建议（英文系统）|
|---|---|---|
| 400 | Zod 校验失败：size > 16GB / content-type 不是 video/* / 扩展名不在白名单 | `Invalid video file (max size: 16 GB, supported: .mp4/.mov/.mkv/.m4v/.webm)` |
| 401 | Dev bypass off，JWT 缺失或过期 | `Please sign in again to upload videos.` |
| 403 | PATCH jobs 时没带 `X-Internal-Token` 或 token 错（前端正常用户不会遇到，Worker 才会） | `Forbidden (internal service only).` |
| 404 | projectId 不属于该用户；jobId 不存在或属主不匹配；HeadObject 说云端没文件 | `Project not found.` / `Upload failed. Please try again.` |
| 409 Conflict | POST process 时 video.status 仍是 PROCESSING（重复入队）| `AI analysis is already running for this video.` |
| 500 | R2 预签名生成失败（ACCESS_KEY_ID 错 / endpoint 错 / bucket 不存在）| `Failed to create upload session. Please try again.`（不要把 AWS SDK 原始堆栈暴露给用户，API 层 log 到 Winston 即可）|

---

## 6. 本地全离线可跑方案（无云服务 / 飞机 / 断网场景）

本项目所有依赖的云服务都有 **1:1 的本地 Docker 替代品**，无需 Cloudflare/Supabase/Upstash 账号即可跑通 1-9 步全流程 + 真 YOLOv8 MPS 推理：

```mermaid
flowchart LR
    subgraph LOCAL [🧱 All running on your MacBook via docker compose + poetry + pnpm dev]
        direction LR
        W[apps/web:3000] -->|HTTP| A[services/api:4000]
        A -->|prisma| PG[(Postgres 16 alpine<br/>docker 5432<br/>↔ 替代 Supabase)]
        A -->|bullmq| RD[(Redis 7 alpine<br/>docker 6379<br/>↔ 替代 Upstash)]
        W -->|PUT XMLHttpRequest| M[MinIO latest<br/>docker 9000<br/>↔ 替代 Cloudflare R2<br/>两个桶 auto-created]
        A -->|S3 SDK getSignedUrl + forcePathStyle=true| M
        AI[services/ai-worker<br/>poetry run python -m app<br/>🐍 local process MPS YOLOv8] -->|rq.BLPOP| RD
        AI -->|PATCH jobs + POST highlights + X-Internal-Token| A
        AI -->|download source + upload exports| M
    end
```

### 6.1 本地 5 步跑通真流程（不用云服务，MPS GPU 加速 ✅）

#### Step 1：起本地 4 个基础设施容器（Postgres / Redis / MinIO + create-buckets）
```bash
cd /Users/jiexinli/MyProjects/shoot-the-ball
docker compose up -d
```
✅ 完成标志：
- 浏览器打开 [http://localhost:9001](http://localhost:9001)（MinIO 管理后台），用 `rootuser / rootpass123` 登录 → 左侧 Buckets → 看到 **shoot-the-ball-source** 和 **shoot-the-ball-exports** 两个桶已经自动建好（通过 infra/compose/dev-infra.yml L74 的 `create-buckets` service 跑 mc mb 命令建好的，不用手动点）
- `docker compose ps` → 4 个容器 `State = Running`（postgres / redis / minio / create-buckets exited 0）

#### Step 2：切换 **API + AI Worker** 的 env 指向本地 Docker（关键：env 双份切换）
> 🛡️ 千万不要动你已经填好云服务的 `.env` 和 `.env.local`！我们新建 `.env.local` 的 **本地模式专用文件** 或者复制一份替换 4 组变量即可：

```bash
# 备份你现在的云服务 env（以后切回去只要 cp 回来）
cp services/api/.env.local services/api/.env.cloud-backup
cp services/ai-worker/.env.local services/ai-worker/.env.cloud-backup
```

然后把下面 4 组变量 **覆盖写入** 到两个 `.env.local` 文件里（保持所有其他变量不变，特别是 `API_INTERNAL_TOKEN` 要两边字节级一致）：

| env 变量名 | 本地模式值 | 注释 |
|---|---|---|
| `DATABASE_URL` | `postgresql://shoot:shootdevpass123@127.0.0.1:5432/shoot_the_ball_dev?pgbouncer=true&schema=public` | 对应 [dev-infra.yml L28-L31](file:///Users/jiexinli/MyProjects/shoot-the-ball/infra/compose/dev-infra.yml#L28-L31) 的 POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB |
| `DIRECT_DATABASE_URL` | `postgresql://shoot:shootdevpass123@127.0.0.1:5432/shoot_the_ball_dev?schema=public` | Prisma migrate 用，不带 pgbouncer，端口 5432 |
| `REDIS_URL` | `redis://default:shootredisdevpass123@127.0.0.1:6379/0` | 对应 [dev-infra.yml L45](file:///Users/jiexinli/MyProjects/shoot-the-ball/infra/compose/dev-infra.yml#L45) `--requirepass`；注意是 `redis://` 非 TLS，本地不需要 rediss:// |
| `STORAGE_PROVIDER` | `s3` 或 `r2` 都行（MinIO 也是 S3-compatible，forcePathStyle=true 生效）| 都可以 |
| `STORAGE_ENDPOINT` | **`http://127.0.0.1:9000`** | ⚠️ 非常重要：指向本地 MinIO 9000 端口，不要带 https://（本地 http 即可） |
| `STORAGE_REGION` | `us-east-1` | 随便填，MinIO 对 region 名不敏感，只要非空就行；不要再填 auto（auto 是 R2 专属约定） |
| `STORAGE_ACCESS_KEY_ID` | `rootuser` | 对应 [dev-infra.yml L59](file:///Users/jiexinli/MyProjects/shoot-the-ball/infra/compose/dev-infra.yml#L59) MINIO_ROOT_USER |
| `STORAGE_SECRET_ACCESS_KEY` | `rootpass123` | 对应 [dev-infra.yml L60](file:///Users/jiexinli/MyProjects/shoot-the-ball/infra/compose/dev-infra.yml#L60) MINIO_ROOT_PASSWORD |

```bash
# 确认 4 组变量改完后：切回云服务只要 cp .env.cloud-backup .env.local 即可，完全可逆
```

#### Step 3：Prisma 推 schema 到本地 Postgres，跑 seed
```bash
cd /Users/jiexinli/MyProjects/shoot-the-ball/services/api

# Prisma CLI 只认 .env 不认 .env.local，所以每次操作前先 cp 一次（别 git commit .env！）
cp .env.local .env
pnpm db:generate      # 生成 Prisma Client（第一次才需要）
pnpm db:push          # 把 schema.prisma 的所有表推到本地 Postgres shoot_the_ball_dev
pnpm db:seed          # 插入默认 userId=user_dev_000000000000001 + projectId=proj-dev-default-001
rm .env               # 用完删掉，防止 git 误提交（pnpm dev 会优先读 .env.local）
```
✅ 完成标志：`db:seed` 终端打印 4 条 "Created ..."，没有 `P1001 Can't reach database server` 报错 → DB 全通。

#### Step 4：**第一次本地真模型**（下载 YOLOv8 权重 + MPS GPU 预热验证）
```bash
cd /Users/jiexinli/MyProjects/shoot-the-ball/services/ai-worker

# 4-a) 安装 Python 依赖
poetry install --no-interaction

# 4-b) 先手动跑一段最小 YOLOv8-mps 预热脚本（只要这个过了，真 pipeline 一定能跑）
poetry run python3 << 'PYEOF'
from ultralytics import YOLO
import torch

if torch.backends.mps.is_available():
    device = "mps"
    print("✅ MPS GPU (Apple Silicon) detected, using device=mps")
else:
    device = "cpu"
    print("⚠️  MPS not available, fallback to CPU (will be ~10x slower)")

# 第一次运行会自动下载 6MB 的 yolov8n.pt 到 ~/.cache/ultralytics
# （不用担心：这个模型是 nano 级最小模型，6MB，下载 1 秒，推理速度在 M2 上 ~400 fps）
model = YOLO('yolov8n.pt')

# 推一个纯黑图片做 warmup，确保 MPS kernel 编译完（第一次可能 10-15 秒，之后就快了）
import numpy as np
dummy = np.zeros((1, 3, 640, 640), dtype=np.uint8)
_ = model(dummy, device=device, verbose=False)
print(f"✅ YOLOv8n warmed up on device={device}!")
PYEOF
```
✅ 完成标志：最后打印 `✅ YOLOv8n warmed up on device=mps!`。如果 MPS kernel 编译日志比较多不用怕，正常现象，M1/M2 系列第一次跑 PyTorch MPS 都会后台编译 Metal shader。
⚠️ 如果卡在下载上卡住 30 秒没动静：手动 `curl -L -o ~/.cache/ultralytics/yolov8n.pt https://github.com/ultralytics/assets/releases/download/v8.1.0/yolov8n.pt`

**注意（提前说的坑）**：我读代码发现现在 [player_detector.py L38-L63](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/ai-worker/app/detectors/player_detector.py#L38-L63) 的 3 个 Detector 子类 `detect()` 方法还全是空的 `return []`（MVP 阶段把真 YOLO 调用留作 TODO 占位）。所以如果你直接跑 pipeline，不会触发检测。先用 `AI_DEMO_MODE=true` 跑通队列链路，再接真模型。接真模型的代码我可以下一步帮你改（把 3 个 detect 换成 YOLO() 调用 + MPS 自动选 device + 分批 batched inference，大概 60 行代码左右）。

#### Step 5：4 个终端并发起，拖视频跑全流程

按顺序在 4 个**独立终端窗口**依次启动（不要关窗口，关了进程就没了）：

```bash
# 🪟 终端 1：Node API
cd services/api && cp .env.local .env && pnpm dev          # 看到 "API listening on http://127.0.0.1:4000" 就 OK

# 🪟 终端 2：Python AI Worker（AI_DEMO_MODE=true 先跑调度链路，不要开真模型）
cd services/ai-worker && poetry run python -m app
# 📝 启动日志要出现 "Starting AI Worker, listening to ['video-processing', 'video-export']"

# 🪟 终端 3：Next.js 前端
cd apps/web && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4000/v1 pnpm dev
# 浏览器自动打开 http://localhost:3000

# 🪟 终端 4（可选）：Prisma Studio 可视化看 DB 每一步数据变化，超好用
cd services/api && cp .env.local .env && pnpm db:studio
# 浏览器打开 http://localhost:5555 → 左侧点 ProcessingJob → 每次前端拖视频，能看到 status 从 PREPARING 到 READY 的变化
```

### 6.2 本地 vs 云服务模式切换：一键 cp 切换脚本（可选自己存在 /scripts）

```bash
#!/bin/zsh
# ./scripts/switch-env-mode.sh local | cloud
MODE=$1
cd /Users/jiexinli/MyProjects/shoot-the-ball
case $MODE in
  local)
    cp services/api/.env.local services/api/.env.cloud-backup 2>/dev/null
    cp services/ai-worker/.env.local services/ai-worker/.env.cloud-backup 2>/dev/null
    cp .env .env.cloud-backup 2>/dev/null
    echo "✅ Switched to LOCAL mode (MinIO + docker Postgres/Redis). Re-run pnpm dev."
    ;;
  cloud)
    cp services/api/.env.cloud-backup services/api/.env.local 2>/dev/null
    cp services/ai-worker/.env.cloud-backup services/ai-worker/.env.local 2>/dev/null
    cp .env.cloud-backup .env 2>/dev/null
    echo "☁️  Switched to CLOUD mode (Cloudflare R2 + Supabase + Upstash). Re-run pnpm dev."
    ;;
  *) echo "Usage: $0 local | cloud"; exit 1 ;;
esac
```

---

## 7. 端到端自检命令集（每次 push 代码前都可以跑一遍）

```bash
# 1. 共享包编译（前后端类型契约必须一致）
cd /path/to/shoot-the-ball
pnpm --filter @shoot-the-ball/contracts build

# 2. API 编译 + Lint + Unit Test（CI 同款）
cd services/api && cp .env.local .env && pnpm lint && pnpm build && pnpm test && rm .env

# 3. AI Worker Lint + Unit Test（CI 同款）
cd services/ai-worker && poetry run ruff check app tests && poetry run pytest -q

# 4. Web TS 类型检查
cd apps/web && npx tsc --noEmit

# 5. 真实 SSE 心跳测试（确保 25s 心跳真的推了）
cd /Users/jiexinli/MyProjects/shoot-the-ball
timeout 30 curl -N http://127.0.0.1:4000/v1/jobs/<any-existing-jobId>/events | grep -E 'heartbeat|progress' | head -5
```

---

**— 文档结束 —**
