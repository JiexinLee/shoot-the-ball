# 视频上传 → 校准 → AI 分析 → SSE 进度推送：完整行为规范

> **文档版本**：1.2 (MVP Phase, updated 2026-10-02)  
> **适用模块**：`apps/web` (Next.js 前端) ↔ `services/api` (Node.js 后端) ↔ `services/ai-worker` (Python 推理服务) ↔ Cloudflare R2 ↔ Redis  
> **Hard Constraints（方向性永久约束，用户已明确决策）**：
>
> 1. 所有用户界面、API 文档、错误信息、日志输出均为**纯英文**系统
> 2. 视频上传必须使用 **预签名 URL Direct Upload** 方案，二进制流 **绝对不经过 API 服务中转**（节省带宽）
> 3. API ↔ AI Worker 内部通信必须携带 `X-Internal-Token` 自定义请求头（Hard Constraint，不走 JWT Bearer）
> 4. 视频处理进度推送必须使用 **SSE (Server-Sent Events)** 流式架构
> 5. **Dev/Prod 统一使用 Cloudflare R2，不在本地起 MinIO / Docker S3 替代**（用户方案 A 决策，见 env 下方 `DEV_MOCK_STORAGE` / `DEV_MOCK_PROCESSING` 两个独立开关）
> 6. **不要内联 Mock Worker**。本地 MVP 阶段走真 API + 真上传，AI 未接入时用 `DEV_MOCK_PROCESSING=true`（env 开关）让 API 自己把 Video/ProcessingJob 写终态并生成兜底 mock highlights；ai-worker 接好后关掉开关即可切换真调度，代码零改动（用户方向性约束）
> 7. **Calibration MVP 仅 2 类 ROI**：`hoopRoi` 必选 + `courtRoi` 可选，球/人 ROI 以后迭代加（用户明确 4 个澄清决策之一）
> 8. **MVP 一次只处理一个视频**：DropZone `multiple=false`，后续队列/批量处理再开

---

## 1. 流程总览图

```mermaid
flowchart TD
    A[👤 用户拖拽或选中视频文件] --> B[📱 前端 probeVideo<br/>本地读 metadata]
    B --> C[1️⃣ POST /v1/videos/upload-session<br/>申请预签名 URL]
    C --> D[🗄️ API 写 Supabase DB<br/>status = UPLOADING]
    D --> E[2️⃣ ✉️ 前端 PUT 到预签名 URL<br/>直传 Cloudflare R2<br/>（完全不经过 API）]
    E --> F[3️⃣ POST /v1/videos/:id/complete<br/>通知 API 上传完成]
    F --> G[🔍 API 调 HeadObject<br/>**真实校验云端文件存在**<br/>⚠️ 绝不信任前端 size 参数]
    G --> H[🗄️ DB: status = UPLOADED]
    H --> I[📐 Modal 切 Step 2: Calibrate<br/>用户点击式画 ROI 矩形<br/>hoopRoi 必选 / courtRoi 可选]
    I --> J[3.5️⃣ POST /v1/videos/:id/calibration<br/>saveCalibration 写 Video.calibration JSON<br/>⭐ 4. process 不是前端单独按钮，是 saveCalibration 成功后自动触发]
    J --> K[4️⃣ POST /v1/videos/:id/process<br/>自动入队分析]
    K --> L[📮 API 入队 BullMQ → Redis<br/>ProcessingJob.status = PREPARING<br/>或 DEV_MOCK_PROCESSING=true 时 API 自己写终态]
    L --> M[🐍 Python AI Worker BLPOP 弹出任务<br/>或 mock 直接跳过]
    M --> N[🧠 HighlightPipeline 4 阶段<br/>Prepare → Detect → Verify → Generate]
    N --> O[5️⃣ PATCH /v1/jobs/:id<br/>X-Internal-Token 鉴权<br/>每阶段 / 每 0.5% 回写进度]
    O --> P[6️⃣ GET /v1/jobs/:jobId/events<br/>SSE 长连接]
    P --> Q[📡 API 每 1.5s 轮询 DB<br/>每 25s 心跳包]
    Q --> R[🟢 PATCH READY + POST highlights/bulk<br/>写入精彩片段]
    R --> S[✅ SSE 推送 completed 事件<br/>连接关闭，卡片变绿 Ready]
```

> ⚠️ **React 18 StrictMode 上传 effect 硬坑（在 `[apps/web/components/video/UploadWorkflowDialog.tsx](file:///Users/jiexinli/MyProjects/shoot-the-ball/apps/web/components/video/UploadWorkflowDialog.tsx)` 里**）：
> useEffect 内 run() 所有 await 后的 early return guard，**永远不要再加闭包 `let cancelled` 或 `cancelledRef.current` 检查**，只允许检查 `uploadStartedForIdRef.current !== localId`。
> 原因：StrictMode 会故意执行 `effect() → cleanup() → effect()`，第一次 cleanup 把 `cancelled=true`，但第二次 effect 被 `uploadStartedForIdRef` guard 挡住根本进不来，**永远没机会 reset cancelled=false**，导致 run() 在 await createUploadSession 恢复后静默命中 `if(cancelled) return`，前端卡死在 "Creating upload session… 0%"，Network Tab 里 PUT R2 请求永远不会发。

---

## 2. 调用时序表（端到端 12 步，含 HTTP 方法、Body、状态变化、关键校验）

| #   | 触发方                       | HTTP 端点                                 | 鉴权                                                 | Body / Payload                                                                                                                                                   | 关键校验 & 状态机变化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 返回值 / UI 表现                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------- | ----------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | **系统启动**                 | -                                         | -                                                    | -                                                                                                                                                                | API 加载 Helmet/CORS，挂载 6 个 namespace routes；Worker 启动队列监听；env 统一在**项目根 `.env`**，子包不再单独维护                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [main.ts](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/main.ts) + [env.ts](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/config/env.ts)                                                                                                                                                                  |
| 1   | 👤 用户松手                  | N/A（浏览器本地）                         | N/A                                                  | 视频 File 对象                                                                                                                                                   | `document.createElement('video')` 读 `loadedmetadata`，拿到 **duration / width / height**；MVP 强制单文件 `multiple=false`，多文件被自动 drop 掉只取第一个                                                                                                                                                                                                                                                                                                                                                                                                                | 卡片初始化，进度条 0% Pending；如果 DB 已经有视频，Hero + DropZone + 空态标题全部隐藏，只显示 Processed Videos 列表（删除最后一个视频后恢复空态）                                                                                                                                                                                                 |
| 2   | 📱 前端                      | **`POST /v1/videos/upload-session`**      | JWT / dev bypass fixed user                          | ```json<br/>{<br/> "projectId": "proj-dev-default-001",<br/> "filename": "game1.mp4",<br/> "contentType": "video/mp4",<br/> "size": 123456789<br/>}              | ✅ 校验 extension 白名单<br/>✅ size ≤ 16GB (Zod 强校验)<br/>✅ projectId 必须属于当前 userId（防越权）<br/>✅ Prisma `video.create({status: UPLOADING})`<br/>✅ **DEV_MOCK_STORAGE=false**：返回真实 Cloudflare R2 SigV4 预签名 URL；**DEV_MOCK_STORAGE=true**：返回 `mock://` 占位字符串，前端不发 PUT，直接 setTimeout tick 0→100（调试/演示用，不用配 R2 CORS）                                                                                                                                                                                                       | `json<br/>{<br/>  "videoId": "cl_xxx",<br/>  "uploadUrl": "https://<r2-endpoint>/...?X-Amz-Signature=... 或 mock://...",<br/>  "storageKey": "videos/<proj>/.../game1.mp4",<br/>  "uploadMethod": "PUT",<br/>  "uploadExpiresInSec": 900<br/>}<br/>` 卡片状态：**Uploading 0%**；Modal 右上角显示 3 步进度指示器（Upload → Calibrate → Start AI） |
| 3   | 📱 前端直连存储（或 mock）   | **`PUT <uploadUrl>`**                     | 预签名 URL SigV4（mock 分支无网络请求）              | 二进制 file 流（Content-Type 必须与申请时一致，否则 R2 403）                                                                                                     | `xhr.upload.onprogress (loaded/total)` 实时驱动真实进度条；用户点击 ✕ → `AbortController.abort()` 中断；**StrictMode 坑：cleanup abort 只中断 XHR，不打 cancelled flag，run() await 后只看 `uploadStartedForIdRef`**（否则卡在 0%）                                                                                                                                                                                                                                                                                                                                       | 进度条真实涨百分比 → 100%；mock 分支 10 步 setTimeout 0→10→…→100                                                                                                                                                                                                                                                                                  |
| 4   | 📱 前端                      | **`POST /v1/videos/:id/complete`**        | JWT / dev bypass                                     | `json<br/>{<br/>  "duration": 7200.5,<br/>  "width": 1920,<br/>  "height": 1080<br/>}<br/>`（所有字段可选）                                                      | 🔴 **HARD SAFETY CHECK**：API 调 R2 `HeadObject` **真实检查文件是否存在于云端**；若 mock 分支则跳过（因为没真上传）<br/>✅ **`sizeBytes` 写入 DB 时用 HeadObject 返回的真实 `Content-Length`**，不用前端传的 size（防篡改）<br/>✅ status: `UPLOADING → UPLOADED`；**⚠️ complete 接口不会把 status 改 PROCESSING，也不会自动入队**（因为还要 Calibration）                                                                                                                                                                                                                | Modal 立即从 Step 1 切到 Step 2：Calibrate，显示视频 + 十字辅助线 + ROI 工具条，进度条保持 100%                                                                                                                                                                                                                                                   |
| 4.5 | 👤 用户（Modal 内操作）      | N/A（纯前端状态机）                       | N/A                                                  | 点击视频上 2 个点 → 生成矩形 → 保存                                                                                                                              | MVP 使用「**点击式画矩形**」（不引入拖拽库，最快实现）：先点左上角，再点右下角，生成 bbox；自动对齐真实 video 渲染矩形（不是父容器，去黑边）<br/>✅ `hoopRoi` **必选**，不画不让点 Next；`courtRoi` 可选<br/>**Auto Calibrate 按钮**：disabled + Tooltip "Coming soon" 占位（后端 endpoint 以后补）                                                                                                                                                                                                                                                                       | 画完 1 个 ROI 立刻显示绿色实线矩形 + 百分比坐标；Next 按钮在 hoopRoi 画完后才可点击                                                                                                                                                                                                                                                               |
| 5   | 📱 前端（点击 Next 自动）    | **`POST /v1/videos/:id/calibration`**     | JWT / dev bypass                                     | `json<br/>{<br/>  "hoopRoi": {x,y,w,h},<br/>  "courtRoi": {x,y,w,h} \| null<br/>}<br/>`（x/y/w/h 都是 0-1 归一化坐标，后端存 Video.calibration JSON 列）         | ✅ Zod schema 强校验：hoopRoi 必选且所有字段 0-1 范围；courtRoi 要么 null 要么 0-1<br/>✅ DB Video.calibration = 保存的 JSON                                                                                                                                                                                                                                                                                                                                                                                                                                              | 返回 200 成功后，前端**自动**立刻调下一步的 process（用户不用再点一个"Start AI"按钮）；Modal 自动切 Step 3: Start AI 状态，显示 AI Processing 文案 + SSE 进度                                                                                                                                                                                     |
| 6   | 📱 前端（auto，接 5 成功）   | **`POST /v1/videos/:id/process`**         | JWT / dev bypass                                     | 空 Body                                                                                                                                                          | ✅ 仅允许 `status == UPLOADED \|\| FAILED` 入队；PROCESSING / PROCESSING 的直接 409 Conflict（防重复 Worker 浪费资源）<br/>✅ Prisma `processingJob.create({status: PREPARING, progress: 0})`<br/>✅ BullMQ 入队 Redis List `video-processing`，jobId = ProcessingJob.id（幂等去重）<br/>✅ 3 次指数退避重试（失败自动重跑）<br/>✅ **DEV_MOCK_PROCESSING=true**：不入真队，API 端直接写 status=READY 终态 + 调 `maybeGenerateAndSaveMockHighlights(video, count=3, useMock=true)` 生成 3 条兜底 highlight，SSE 一订阅立刻完成事件（MVP 不用起 ai-worker 也能看完整链路） | `json<br/>{<br/>  "jobId": "cl_xxx_<processingJobId>"<br/>}<br/>`前端存 jobId，下一步 SSE 订阅                                                                                                                                                                                                                                                    |
| 7   | 🐍 Python AI Worker（常驻）  | Redis BLPOP `video-processing` queue      | N/A（内部 Redis 协议）                               | `{videoId, projectId, userId, storageKey}`                                                                                                                       | Worker `process_video()` 主循环：<br/>1. `_update_api_job(PREPARING, 0.02)` → 调 PATCH<br/>2. `s3.get_object(shoot-the-ball-source, storageKey)` → 下载源视频到 /tmp<br/>3. 4 阶段 pipeline.run(ctx)，**PipelineContext 里带用户保存的 hoopRoi/courtRoi**<br/>4. POST `/highlights/bulk` 批量写结果<br/>5. PATCH status=`READY` progress=1.0                                                                                                                                                                                                                              | N/A（异步，在 Worker 进程内执行，终端打印 INFO 日志）；DEV_MOCK_PROCESSING=true 时整个 Worker 进程不需要启动                                                                                                                                                                                                                                      |
| 8   | 🐍 Worker（每阶段每 0.5%）   | **`PATCH /v1/jobs/:id`**                  | 🔐 **`X-Internal-Token` 自定义头**（不是 JWT！）     | `json<br/>{<br/>  "status": "DETECTING",<br/>  "progress": 0.15,<br/>  "stage": "Detecting ball (coarse pass 1/3)",<br/>  "pipelineVersion": "0.1.0"<br/>}<br/>` | ✅ `X-Internal-Token !== API_INTERNAL_TOKEN → 403 Forbidden`（Hard Constraint）<br/>✅ 状态机强校验，只允许 PREPARING → DETECTING → VERIFYING → GENERATING → READY，不允许跳步                                                                                                                                                                                                                                                                                                                                                                                            | 前端不可见；写入 DB ProcessingJob 表 progress/stage/status 字段                                                                                                                                                                                                                                                                                   |
| 9   | 📱 前端 SSE 订阅             | **`GET /v1/jobs/:jobId/events`**          | JWT / dev bypass + 只允许属主订阅他人 jobId 返回 403 | N/A（长连接）                                                                                                                                                    | API 侧：<br/>✅ Content-Type: `text/event-stream; charset=utf-8`<br/>✅ Cache-Control: `no-cache, no-transform`<br/>✅ X-Accel-Buffering: no（禁止 nginx 缓冲 SSE 包）<br/>✅ `setInterval(1.5s) → Prisma findProcessingJob` 轮询 DB<br/>✅ 节流：仅 progress 变化 ≥ 0.5% 才推事件<br/>✅ `setInterval(25s) → heartbeat` 包防 60s 反向代理断连<br/>✅ 10min 硬超时 → res.end() 防僵尸连接<br/>✅ `req.on('close')` 清两个 interval（防内存泄漏）<br/>✅ 读到 READY → `event: completed`；读到 FAILED → `event: failed` + 错误信息                                         | **SSE 事件流**：<br/>`<br/>event: progress<br/>data: {"jobId":"...", "stage":"Verifying", "progress":0.42}<br/><br/>event: heartbeat<br/>data: {"ts":1727131234567}<br/><br/>event: completed<br/>data: {"jobId":"...", "status":"READY"}<br/>`                                                                                                   |
| 10  | 🐍 Worker（pipeline 结束）   | **`POST /v1/videos/:id/highlights/bulk`** | 🔐 `X-Internal-Token`                                | 最多 5000 条 highlights（startTime/endTime/type/clipStorageKey）                                                                                                 | 💣 Prisma `$transaction` 原子：<br/>1. 软删该 videoId 所有旧 highlights（同视频重跑 pipeline 不会出现重复条目）<br/>2. `createMany({data, skipDuplicates: true})` 一次性批量 INSERT<br/>3. ProcessingJob.status = `READY`<br/>MVP 兜底：`maybeGenerateAndSaveMockHighlights(video, count, useMock)` 是 highlights.service.ts 私有方法，**boolean flag `useMock` 控制是否启用，不走 env**（用户约束："单独抽离出去成一个方法在当前文件，就用一个 boolean 的 flag 来进行判断是否使用，不要用 env"）                                                                         | DB：写入 clips；DEV_MOCK_PROCESSING 路径下 useMock=true，生成 startTimeSec/endTimeSec/timeSec 等 Sec 字段兼容旧 UI（真实 highlights 用 startTime/endTime 秒浮点）                                                                                                                                                                                 |
| 11  | 📱 前端 SSE 回调             | N/A                                       | N/A                                                  | N/A                                                                                                                                                              | `event: progress` → 进度条涨 + stage 文案提示<br/>`event: completed` → Modal 自动关闭，父组件 VideoUploader 刷新卡片列表<br/>`event: failed` → Modal 显示 error + Retry 按钮                                                                                                                                                                                                                                                                                                                                                                                              | Processed Videos 列表里对应卡片：绿色 ✅ Ready badge + highlights 数量                                                                                                                                                                                                                                                                            |
| 12  | 📱 前端（卡片 highlight 区） | N/A（纯前端播放器）                       | N/A                                                  | GET video downloadUrl 预签名 URL                                                                                                                                 | MVP 用 **HTML5 Media Fragment** `src={downloadUrl}#t=start,end` 实现按 clip 时间独立播放：**不在前端真切 mp4，不接 ffmpeg.wasm，保持 0 依赖**<br/>✅ 每一条 highlight 一个独立 `<video controls>` 小卡片，不会互相干扰<br/>✅ 展示 2PT / 3PT · HOME / AWAY · confidence 百分比 · MOCK 虚线边框（dev mock 一眼识别）                                                                                                                                                                                                                                                       | 卡片下方 `grid sm:grid-cols-2` 展示 2 列 highlight clip 播放器；Processed Videos 顶部有 Select / Select All / Export 3 个 disabled + Tooltip "Coming soon" 占位按钮（为以后批量合 clip 导出做 UI 预留）                                                                                                                                           |

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

| 状态               | 触发时机                                                          | progress 范围 |
| ------------------ | ----------------------------------------------------------------- | ------------- |
| `PENDING`          | DB 刚 create，还没入 BullMQ                                       | 0             |
| `PREPARING`        | Worker 刚从 Redis BLPOP 弹出任务，开始 R2 下载源视频              | 0 ~ 0.05      |
| `DETECTING`        | Coarse + Fine 两阶段 YOLO 推理中                                  | 0.05 ~ 0.85   |
| `VERIFYING`        | 轨迹 / 篮球抛物线 / 得分验证 + NMS 去重                           | 0.85 ~ 0.95   |
| `GENERATING_CLIPS` | ffmpeg -ss/-t 切 3P/FT/dunk 等 clip，上传导出桶                   | 0.95 ~ 0.99   |
| `READY`            | highlights bulk 写入成功                                          | 1.0           |
| `FAILED`           | 任意阶段异常，worker `_update_api_job(FAILED, error_message=xxx)` | 0 ~ 1.0       |

---

## 4. 关键安全 & 省钱决策索引（MVP 架构核心）

> 💡 每一条都是 MVP 阶段的成本/安全分水岭，不要随意改动

| #   | 决策                                                                       | 在哪里实现                                                                                                                                | 为什么这样做                                                                                                                             |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | 预签名 URL Direct Upload（视频不走 API 中转）                              | [videos.routes.ts L60-L69](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L60-L69)     | **省钱关键**：10GB 视频走 API 中转 → API 出口 10GB + R2 入口 10GB → $1.5；直连 R2 → $0 出口费                                            |
| 4.2 | complete 阶段 **必须 HeadObject 真实校验云端文件**，不信客户端 size        | [videos.routes.ts L205-L223](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L205-L223) | **Lesson Learned 安全硬约束**：否则恶意用户直接 curl `/complete` 就能造一条假记录，占用 DB storage quota                                 |
| 4.3 | `sizeBytes` 写 DB 用 HeadObject 返回的真实 `Content-Length`                | [videos.routes.ts L218-L221](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L218-L221) | 防止前端 JS 被改，把 10GB 说自己是 10MB 绕过 storage 配额                                                                                |
| 4.4 | PATCH /jobs & POST highlights/bulk 必须走 **`X-Internal-Token`**，不是 JWT | [jobs.routes.ts L226-L234](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L226-L234)       | Hard Constraint：JWT 是面向用户的短 TTL token，Worker 是内部服务，用独立长 token + 自定义头，被泄露也无法冒充用户调 /me /projects 等接口 |
| 4.5 | SSE 25s 心跳包 + 10min 硬断                                                | [jobs.routes.ts L107-L112](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L107-L112)       | **SSE 性能硬约束**：反向代理/Cloudflare 默认 60s 空闲没数据就掐断长连接，25s 心跳保活；10min 硬断防用户关浏览器后连接占内存              |
| 4.6 | highlights bulk 事务两阶段：先软删旧 → 再 createMany 新                    | [videos.routes.ts L376-L392](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L376-L392) | 同一视频重跑 pipeline 时，不会出现 "同一个 3P 进球两条记录" 的数据重复；createMany 比 for 循环单条 insert 快约 100 倍                    |
| 4.7 | POST process 仅允许 UPLOADED / FAILED 入队                                 | [videos.routes.ts L285-L290](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/videos.routes.ts#L285-L290) | 防止用户快速连点两次按钮，导致同一视频同时入队 2 个 Worker 吃 GPU 配额 x2                                                                |
| 4.8 | SSE 节流：progress 变化 ≥ 0.5% 才推事件                                    | [jobs.routes.ts L124-L128](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/jobs/jobs.routes.ts#L124-L128)       | 1.5s 轮询 1 次，10min 内最多 40000 次事件；加上节流，实际推送 ~200 次 = 前端 CPU rerender 次数 × 200 减少                                |

---

## 5. 错误码速查表（前端 UX 对接必备）

| HTTP Code    | 场景                                                                                  | 用户文案建议（英文系统）                                                                                              |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 400          | Zod 校验失败：size > 16GB / content-type 不是 video/* / 扩展名不在白名单              | `Invalid video file (max size: 16 GB, supported: .mp4/.mov/.mkv/.m4v/.webm)`                                          |
| 401          | Dev bypass off，JWT 缺失或过期                                                        | `Please sign in again to upload videos.`                                                                              |
| 403          | PATCH jobs 时没带 `X-Internal-Token` 或 token 错（前端正常用户不会遇到，Worker 才会） | `Forbidden (internal service only).`                                                                                  |
| 404          | projectId 不属于该用户；jobId 不存在或属主不匹配；HeadObject 说云端没文件             | `Project not found.` / `Upload failed. Please try again.`                                                             |
| 409 Conflict | POST process 时 video.status 仍是 PROCESSING（重复入队）                              | `AI analysis is already running for this video.`                                                                      |
| 500          | R2 预签名生成失败（ACCESS_KEY_ID 错 / endpoint 错 / bucket 不存在）                   | `Failed to create upload session. Please try again.`（不要把 AWS SDK 原始堆栈暴露给用户，API 层 log 到 Winston 即可） |

---

## 6. 本地 MVP 方案（无需 ai-worker 进程、MinIO 可选 —— 用户方向性约束已固化）

> ⚠️ **用户最终决策（永久约束）**：
> 「你不要这样写 mock，把它全部去掉。我现在只需要一个开关来进行控制，可以放在 env 里面，然后给我写好 comment 就可以。然后我有了 ai worker 之后就打开那个开关（来切换 / 关闭 mock，走真调度）。我的目的是不要搞得太复杂，现在先简化操作，把我 api + web 都弄通，之后再加上 ai worker。」
> 「Cloudflare R2：Dev/Prod 统一用云端 R2，不用本地 Docker 起 MinIO；Bucket CORS 自己去 Cloudflare Dashboard 配。」

**结论：历史文档里写的本地 MinIO / switch-env-mode 切换脚本等方案全部作废，不要用。** MVP 阶段永远走：真 R2（或 mock storage）+ 真 DB/Redis Docker + `DEV_MOCK_PROCESSING` 兜底写终态。

### 6.1 统一 env 结构（永远只有项目根目录一份）

所有子包（services/api / services/ai-worker / packages/*）**都不要单独维护 `.env.local`**。所有变量统一放在 **项目根目录 `.env`**，子包 package.json 的 scripts 里通过 `--env-file ../../.env` 或 `--env-file ../.env` 向上读一份，避免之前 8 个 env 文件泛滥的问题。

打开根 `.env`（非 Git 跟踪，已经有模板）检查下面这几个关键开关：

| env 变量              | 默认值  | 作用（注释已写在 env 文件里）                                                                                                                                                            |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEV_MOCK_STORAGE`    | `false` | `false`：真 PUT 到 Cloudflare R2（需要你在 Cloudflare Dashboard 给 `shoot-the-ball-source` 桶配 CORS：origin `http://localhost:5678`，methods `GET,PUT,HEAD`，Allow `*`，Expose `ETag`） |
|                       |         | `true`：前端返回 `mock://` 占位，完全不发 PUT 请求，本地 setTimeout tick 模拟 0→100。用于演示/调 UI，不用配 R2 CORS，断网也能跑                                                          |
| `DEV_MOCK_PROCESSING` | `true`  | `true`：process 接口里如果 ai-worker 没启动 / 没配置，API 自己直接把 Video / ProcessingJob 写 READY 终态，并调用兜底方法生成 2-3 条 mock highlights（MVP 不用起 Python 进程）            |
|                       |         | `false`：真 BullMQ 入队 Redis，ai-worker 进程必须消费，否则卡片永远卡在 PROCESSING 不绿                                                                                                  |

> 🧠 兜底 highlights 实现约束（用户决策永久有效）：`maybeGenerateAndSaveMockHighlights(video, count, useMock)` 是 [highlights.service.ts](file:///Users/jiexinli/MyProjects/shoot-the-ball/services/api/src/modules/videos/services/highlights.service.ts) 的**私有方法**，通过 `useMock` 这个 **boolean flag** 控制开关，**绝对不要改成通过 env 控制**（用户原话：「请你单独抽离出去成一个方法在当前文件，就用一个 boolean 的 flag 来进行判断是否使用，不要用 env」）。

### 6.2 MVP 本地 4 步全链路跑通（不用 Python ai-worker，不用 MinIO）

```mermaid
flowchart LR
    subgraph LOCALMVP [🧱 本地 Docker 只起 2 个基础设施，其他全靠 env 开关]
        direction LR
        W[apps/web:5678] -->|HTTP| A[services/api:4321]
        A -->|prisma| PG[(Postgres 16 alpine<br/>docker 5432)]
        A -->|bullmq + SSE 轮询| RD[(Redis 7 alpine<br/>docker 6379)]
        W -->|PUT XMLHttpRequest<br/>真实 Cloudflare R2| R2[(☁️ Cloudflare R2<br/>shoot-the-ball-source<br/>桶配 CORS)]
        A -->|DEV_MOCK_PROCESSING=true<br/>直接写 READY 终态<br/>不用 Python| A
    end
```

#### Step 1：起基础设施（只有 2 个容器，Postgres + Redis）

```bash
cd /Users/jiexinli/MyProjects/shoot-the-ball
# ⚠️ docker compose up 不需要起 minio / create-buckets 了（用户决策：走云 R2）
docker compose -f infra/compose/dev-infra.yml up -d postgres redis
```

✅ 完成标志：`docker compose -f infra/compose/dev-infra.yml ps` 两个容器 `State=Running`

#### Step 2：确认根 `.env` 的 DB/Redis 变量（4 组变量）

```
DATABASE_URL=postgresql://shoot:shootdevpass123@127.0.0.1:5432/shoot_the_ball_dev?pgbouncer=true&schema=public
DIRECT_DATABASE_URL=postgresql://shoot:shootdevpass123@127.0.0.1:5432/shoot_the_ball_dev?schema=public
REDIS_URL=redis://default:shootredisdevpass123@127.0.0.1:6379/0
DEV_BYPASS_AUTH=true
DEV_MOCK_STORAGE=false   # 要真传 R2 → false；要断网演示 → true
DEV_MOCK_PROCESSING=true # 没启动 Python → true；ai-worker 跑起来后切 false
```

#### Step 3：Prisma + seed

```bash
cd services/api
pnpm db:generate
pnpm db:push
pnpm db:seed
```

✅ 完成标志：终端打印 4+ 条 `Created ...`；Prisma Studio 能看到 User / Project / Video 空表

#### Step 4：3 个终端并发起（MVP 不需要 ai-worker 终端！）

```bash
# 🪟 终端 1：API
cd services/api && pnpm dev
# 预期："API listening on http://127.0.0.1:4321" + Prisma connected

# 🪟 终端 2：Next.js 前端（端口=5678，因为你已经在 Cloudflare CORS origin 里配的是 5678）
cd apps/web && pnpm dev
# 浏览器打开 http://localhost:5678

# 🪟 终端 3（可选）：DB 可视化
cd services/api && pnpm db:studio
# http://localhost:5555 肉眼看每一步状态变化
```

✅ 验收流程（不启动 Python ai-worker、DEV_MOCK_PROCESSING=true，全程 60s）：

1. 拖 testing-video.MP4 → 3 步 Modal 打开
2. Step 1 Upload：进度条 0 → 100（DEV_MOCK_STORAGE=true 10s 左右；DEV_MOCK_STORAGE=false 真实 R2 PUT 进度）
3. Step 2 Calibrate：点 2 下画 hoopRoi（必选）→ 点 Save + Start AI
4. Modal 关 → Processed Videos 列表卡片绿 ✅ Ready → 展开能看到 3 个独立 `<video controls>` 播放器（每个是 Media Fragment 播对应区间）

---

## 7. MVP 阶段最新已落地能力（2026-10-02 snapshot：现阶段功能先完成）

> 本节是 1.1→1.2 新增，用于记录"现阶段功能先完成"的最新状态，作为 docs 快照。等 ai-worker 接入后再更新成真实链路。

### 7.1 Highlights 链路：真裁剪 clip（不再前端 Media Fragment） + Mock 随机性 + ai-worker 注释

**用户最高优先级硬约束（永久不动）**：`services/api/src/modules/videos/services/highlights.service.ts` **L125-L132** 的 `rawDuration / pre / post / fallback` 赋值行 **100% 保持不动**。

#### 7.1.1 durationHint 链路（老视频 DB duration=NULL 时按真实 duration spread）

- **为什么**：老上传记录 DB `Video.duration` 列仍为 NULL → mock highlights 按 fallback 算会让 17s 视频出现 00:41+ 的假时间。
- **方案（Wrapper Input Pattern，零侵入 L125-132）**：
  - 前端 `GET /v1/videos/:id/highlights?durationHint=<probe durationSec>`
  - 后端 `getVideoHighlightsById` 解析 query.durationHint Number Zod 校验后传 service
  - service 在调用 mock 生成前**浅拷贝 video 对象**：当 DB duration 为空时，把 duration 设为 hint 再传下去
  - 业务层 rawDuration 自动读到真值，L125-132 一行不动

#### 7.1.2 Mock Highlights 改为 Math.random 三段不重叠

- **JSDoc comment**：`maybeGenerateAndSaveMockHighlights` 顶部写了说明，未来 **ai-worker** 会用真实 YOLO / 事件 / 动作识别（进球/三分/助攻/抢断/盖帽）写 highlight，当前 mock 逻辑到时会被替换下线。
- **三段式 slot（永不重叠）**：
  - slot1 = `pickBetween(0.08, 0.40, pre+0.3, duration*0.40)`
  - slot2 = `pickBetween(0.42, 0.70, duration*0.42, duration*0.70)`
  - slot3 = duration 够长时启用 `pickBetween(0.72, 0.96, duration*0.72, maxEventTime)`
  - `pickBetween` 内部 ratio + abs 双 clamp，`hi<=lo` 时取中点，处理短到 2-5s 视频边界不产生 NaN
- **其它随机字段**：score 35% 三分 / team 50% HOME / confidence 0.75–0.95

#### 7.1.3 Clip 真裁剪（ffmpeg -c copy，不重编码）

- **触发点**：GET highlights 时对每条 `clipStorageKey` 为空的 highlight 串行跑 `ensureClipArtifactsForHighlights` → `trimAndUploadClip`
  （失败不抛，catch log，下一次 GET 再重试）
- **流程**：`clip-trimmer.ts`
  1. presigned GET 从 source bucket 下载源视频到本地 /tmp
  2. `spawn ffmpeg -ss <start> -i <src> -t <duration> -c copy -movflags +faststart -avoid_negative_ts make_zero <out>`
     - `-c copy` 不重编码，速度飞快
     - `-movflags +faststart` 让浏览器可以渐进播放，不用下完整个 clip 才开始播
     - `-avoid_negative_ts make_zero` clip 时间戳从 0 开始，否则 seek 会跳到负时间
  3. `object-storage.putObject("exports", "clips/<videoId>/<hlId>.mp4", buffer)` 写 R2 exports bucket
  4. prisma.highlight.update 写回 `clipStorageKey`
- **Web 播放器优先级**：卡片 `<video>` / Preview Dialog 都优先读 `h.clipUrl`（GET highlights 返回时后端用 exports bucket 动态 presign 的短 MP4 URL），进度条显示 clip 自己的短时长（比如 0:04/0:04），不再显示 0:17/0:17 全视频；末尾自动 seek 0 循环播放；fallback 保留旧 timeupdate clamp 方案。

### 7.2 Export 链路：按选中 clip 导出短片段（不是全视频）

**MVP 架构不变**：POST 入队 → setTimeout 假消费端 → GET presigned URL → 前端 poll 后自动触发浏览器下载。

#### 7.2.1 runMockExportConsumer：storageKey 直接指向 clipStorageKey

```
QUEUED →(700ms)→ EXPORTING →(2200ms)→ EXPORTED
写 EXPORTED 时：
1. 读 POST 选中的所有 highlights → findMany(select {id, clipStorageKey})
2. 优先取第一条有 clipStorageKey 的（真裁剪好的 clips/<videoId>/<hlId>.mp4）
3. 全部没裁剪才 fallback highlight.video.storageKey（完整源视频）
4. 多条 MERGE MVP 先取第 1 条 clip 占位，让 UI 下载到 4s 短文件闭环
   （注释标注了未来真实 worker 会用 ffmpeg concat demuxer 真拼成一个长 MP4）
5. 桶 hint 存进 Export.downloadUrl 字段（JSON.stringify {storageBucket:"EXPORTS"|"SOURCE", mock:true}）
   → 不引入 Prisma migration，省 DB push 同步风险
```

#### 7.2.2 GET /exports/:id presign 正确桶（clips/ → exports bucket，防 403）

```
双重兜底判断（不依赖 metadata 存 DB 成功与否）：
1. 先 try JSON.parse(exportRecord.downloadUrl) 读 storageBucket 字段
   如果是 "EXPORTS" → presign exports bucket；如果是 "SOURCE" → source
2. 如果 downloadUrl 为空或不是合法 JSON，直接按 storageKey 前缀：
   key.startsWith("clips/") || key.startsWith("exports/") → presign exports bucket
   其他情况 → presign source bucket
```

**为什么必须做这个**：clips/<..>.mp4 放在 exports bucket；如果 GET exports 硬写 source bucket presign，URL 会 403 Forbidden。

#### 7.2.3 前端 Export 强制下载（fetch blob → <a download>）

- 不走 `window.location.href = downloadUrl`（因为 presign URL 的 Content-Disposition 是 inline，浏览器会直接播不下载）
- 改为 `fetch(downloadUrl) → res.blob() → URL.createObjectURL(blob) → <a download="<safeFilename>.mp4"> 自动 click → revokeObjectURL`
- poll 用 30 次 for 循环 `await sleep(800ms)`（不用递归自引用的 async function）

### 7.3 UI 层：Clip Preview/Delete 独立 + Loader 空态 + Header 去大按钮

#### 7.3.1 UploadQueue Header 删 Preview/Delete 大按钮

- 原来 filename 右边两个 Play/Trash 大按钮整个块删掉；UploadQueueProps onPreview/onRemove 两个 props 一起清理掉
- header 只剩：左侧 filename + 状态 / 右侧 `Select · Select All · Clear All · Export N` 操作栏

#### 7.3.2 每张 ClipCard 自己的 Preview / Delete

- **Preview**：点击 → VideoPreviewDialog 新增 `clipSrc?: string|null` 字段，优先传 `clip.clipUrl`（真短 clip）
  - Dialog 内部 `effectiveSrc = clipSrc ?? video.previewUrl`；`isTrimmedClip = Boolean(clipSrc)`
  - isTrimmedClip 分支：末尾 `currentTime >= duration - 0.05` seek 0 循环播；fallback 保留全视频 timeupdate clamp
- **Delete**：前端维护 `deletedHighlightIds: Set<string>`（不软删 DB highlight，本次工作区不参与）
  - UploadQueue 循环 clips flatMap 时过滤 `if (deleted.has(c.id)) continue`
  - Delete 同步把该 id 从 `selectedHighlightIds` Set 删掉
  - total count / Select All / Export 请求 body highlightIds 四处全部排除 deleted

#### 7.3.3 UploadQueue Loading 空态：黄色 Loader2 + 文案

- `clips.length === 0` 的空态（还在 processing / trim clip 中）不再只显示一行纯文字
- 换成 Lucide `<Loader2>` 图标：
  - `h-8 w-8 text-[var(--primary)] animate-spin`
  - `drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]` 黄色光晕和 muted text 拉开颜色区别
  - strokeWidth 2.25 粗线条，转起来不糊
- 下面一行保留 `Processing highlights… check back shortly.` 文案

### 7.4 现阶段（MVP Snapshot）完整验收步骤（60s 能走完）

```
前提：DEV_MOCK_STORAGE=false(真R2) / DEV_MOCK_PROCESSING=true / docker postgres+redis up
```

1. 拖一个测试 MP4 → Upload 0→100 → Calibrate 点两下画 hoopRoi → Save + Start AI
2. SSE 推 completed → 卡片绿 ✅ Ready，下方出现 3 张 ClipCard
3. **验证 Mock 随机**：Chrome 刷新一次 Workspace，再看 3 张卡片的时间区间（比如 slot1 第一次 8s-12s，第二次可能 11s-15s），两次不一样
4. 任点一张卡片右下角 **Preview** → Dialog 进度条显示 clip 自己短时长（比如 0:04/0:04）不是全视频 43s
5. **Delete** 第 2 张 → grid 剩 2 张；Select All → 显示 2/2（不是 3/3）
6. 勾选第 1 张 → 点 **Export 1** → Network：
   - POST /v1/exports 202 Created → body 有 exportId
   - 之后 ~30 次 GET /v1/exports/:id 轮询
   - 最后一次 GET status=EXPORTED，downloadUrl 是 exports bucket presign URL
   - 浏览器**自动下载** mp4；QuickTime Inspector 看 duration≈4s（不是源视频 17/43s）
7. **双侧编译**：
   ```bash
   pnpm --filter @shoot-the-ball/api exec tsc --noEmit   # exit 0
   pnpm --filter @shoot-the-ball/web exec tsc --noEmit   # exit 0
   ```

---

## 8. 端到端自检命令集（每次 commit 前跑一遍）

```bash
# 1. 共享包编译（前后端类型契约必须一致）
cd /Users/jiexinli/MyProjects/shoot-the-ball
pnpm --filter @shoot-the-ball/contracts build

# 2. API 编译 + Lint
cd services/api && pnpm lint && pnpm build

# 3. Web TS 类型检查（IDE diagnostics 也能看）
cd apps/web && pnpm exec tsc --noEmit
```

> CI/CD 说明：`.github/workflows/ci.yml` / `docker.yml` 目前已把 `on: push / pull_request / tag` 注释掉，只剩 `workflow_dispatch` 手动触发（避免每次 push 都失败浪费 GitHub 配额）。等所有核心接口写完再把注释去掉。

---

**— 文档结束 —**
