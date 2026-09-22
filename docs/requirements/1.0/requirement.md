AI Basketball Highlight Generator
Flutter + Node.js/TypeScript + Python AI Worker Monorepo Architecture & Detailed MVP Implementation Plan
基于原 PRD V1.0 重构。本文保留原产品目标与 AI Pipeline，并将客户端从 Web-first 调整为 Mobile-first Flutter，同时补充工程架构、服务边界、数据模型、API、异步任务、AI Worker、部署与分阶段实施流程。

1. 架构决策摘要
   客户端：Flutter，优先支持 iOS / Android。核心用户流程是手机视频选择/上传 → AI 分析 → Highlight Review → 导出/分享。
   Backend：Node.js + TypeScript。负责认证、Project/Video/Highlight/Export 业务、Signed URL、Job 编排和客户端 API。
   AI Worker：Python。负责 FFmpeg、OpenCV、目标检测、Tracking、Shot Candidate、Made Basket Verification、事件去重和 Highlight 生成。
   Storage：S3-compatible Object Storage，MVP 推荐 Cloudflare R2 或 AWS S3。原始视频必须 Direct Upload。
   Database：PostgreSQL。
   Queue：Redis + BullMQ。Node 创建 Job，Python Worker 消费 Job。
   实时进度：MVP 推荐 SSE；客户端也可先采用 polling，后续切换 SSE 不影响核心业务模型。
   Monorepo：建议统一管理 Flutter、Node Backend、Python Worker、共享文档与基础设施配置；但各运行时保持独立构建和部署。
2. 产品目标与 MVP 边界
   核心闭环：一小时固定机位篮球视频 → AI 找到进球 → 自动生成短片 → 用户快速审核 → 导出。
   支持固定机位篮球训练、单挑或比赛视频。
   支持 MP4 / MOV 等主流视频格式。
   用户标记篮筐 ROI，可选标记球场区域。
   Coarse → Fine 两阶段视频分析。
   Shot Candidate 与 Made Basket 分离。
   每个 Highlight 保存 confidence，并允许用户 Preview、Select、Delete、调整 Start/End。
   支持 Individual Export 与 Merge Export。
   不做实时识别、多机位、复杂专业剪辑、球员身份识别和社交 Feed。
3. 推荐 Monorepo
   shoot-the-ball/ ├── apps/ │ └── mobile/ # Flutter │ ├── lib/ │ │ ├── core/ │ │ ├── features/ │ │ │ ├── auth/ │ │ │ ├── projects/ │ │ │ ├── upload/ │ │ │ ├── processing/ │ │ │ ├── highlights/ │ │ │ └── export/ │ │ └── main.dart │ └── test/ │ ├── services/ │ ├── api/ # Node.js + TypeScript │ │ ├── src/ │ │ │ ├── modules/ │ │ │ ├── routes/ │ │ │ ├── jobs/ │ │ │ ├── storage/ │ │ │ ├── db/ │ │ │ └── main.ts │ │ └── test/ │ │ │ └── ai-worker/ # Python │ ├── app/ │ │ ├── pipeline/ │ │ ├── detectors/ │ │ ├── tracking/ │ │ ├── events/ │ │ ├── clips/ │ │ ├── ffmpeg/ │ │ └── worker.py │ └── tests/ │ ├── packages/ │ └── contracts/ # OpenAPI / JSON Schema / generated types │ ├── infra/ │ ├── docker/ │ └── compose/ │ ├── docs/ │ ├── architecture/ │ ├── api/ │ └── ai/ │ ├── .github/workflows/ ├── docker-compose.yml └── README.md
   建议不要让 Flutter、Node、Python 共用代码目录或运行时依赖。Monorepo 的价值主要是统一版本管理、文档、CI/CD、开发环境和接口契约，而不是强行共享所有代码。
4. 系统总体架构
   Flutter Mobile  │  ├── Auth / Project / Review / Export  │  ├── request upload session  ▼ Node.js API  │  ├── PostgreSQL  ├── Signed URL  └── Redis/BullMQ  │  ▼  Python AI Worker  │  ├── Download/stream source  ├── FFmpeg metadata & sampling  ├── Player/Ball/Hoop detection  ├── Ball tracking  ├── Shot Candidate  ├── Made Basket verification  ├── Event deduplication  └── Highlight generation  │  ▼  Object Storage  │  ▼  Flutter Review / Export
5. 数据模型

6. API 设计
   POST /v1/projects — 创建 Project
   GET /v1/projects/:id — 获取项目详情
   POST /v1/videos/upload-session — 获取 Direct Upload URL / storage key
   POST /v1/videos/:id/complete — 上传完成并写入 metadata
   POST /v1/videos/:id/calibration — 保存 hoop/court ROI
   POST /v1/videos/:id/process — 创建 AI Processing Job
   GET /v1/jobs/:id — 查询 Job 状态
   GET /v1/jobs/:id/events — SSE 处理进度
   GET /v1/videos/:id/highlights — 获取 Highlights
   PATCH /v1/highlights/:id — 调整 start/end 或用户状态
   DELETE /v1/highlights/:id — 删除错误识别
   POST /v1/exports — 创建 Individual/Merge Export Job
   GET /v1/exports/:id — 查询导出状态并获取 Signed URL
7. Direct Upload 流程
   Flutter 上传文件前向 Node 请求 upload session。
   Node 创建 Video 记录并生成 storageKey，同时返回短期 Signed Upload URL。
   Flutter 直接把原始视频上传到 R2/S3，不经过 Node。
   上传完成后 Flutter 调用 /videos/:id/complete。
   Node 或 Worker 读取 duration、resolution、FPS、codec 等 metadata。
   用户确认/标记 hoop ROI，保存 CameraProfile 或本视频 calibration。
   用户点击 Generate Highlights，Node 创建 ProcessingJob 并把 jobId 放入 BullMQ。
8. AI Worker 详细 Pipeline
   Stage 0 — Prepare：下载/访问源视频；使用 FFmpeg 获取 metadata；校验视频可读性。
   Stage 1 — Coarse Sampling：低 FPS 抽帧，优先关注用户标记的 hoop ROI 和可选 court ROI，减少全视频逐帧推理。
   Stage 2 — Candidate Detection：检测 player、ball、hoop；对 ball 进行 tracking；识别可能的投篮时间窗口。
   Stage 3 — Shot Candidate：基于 possession/ball motion/trajectory/hoop proximity 形成 shot candidate，而不是直接判定进球。
   Stage 4 — Fine Verification：只对候选窗口提高采样率，结合球轨迹、篮筐交互、向下离开和 temporal consistency 判断 Made Basket。
   Stage 5 — Confidence：分别保存 ball tracking、trajectory、hoop interaction、temporal consistency 等内部评分，并计算最终 confidence。
   Stage 6 — Deduplication：对相邻/重叠 candidate 做 event clustering，避免一个进球生成多个 Highlight。
   Stage 7 — Clip Generation：默认 eventTime 前 5 秒、后 3 秒生成 Highlight；只生成索引和/或中间片段，最终导出按需执行。
   Stage 8 — Persist：写入 Highlight、metadata、模型版本、处理耗时；更新 ProcessingJob 为 Ready。
9. AI Worker 内部模块
   ai-worker/app/ ├── pipeline/ │ ├── prepare.py │ ├── coarse.py │ ├── fine.py │ └── pipeline.py ├── detectors/ │ ├── player_detector.py │ ├── ball_detector.py │ └── hoop_detector.py ├── tracking/ │ └── ball_tracker.py ├── events/ │ ├── possession.py │ ├── shot_candidate.py │ ├── made_basket.py │ ├── confidence.py │ └── deduplication.py ├── clips/ │ └── highlight_generator.py ├── ffmpeg/ │ ├── metadata.py │ ├── sampling.py │ ├── trim.py │ └── concat.py └── worker.py
10. Queue 与 Job 状态机
    Uploaded  ↓ Preparing  ↓ Detecting  ↓ Verifying  ↓ Generating Clips  ↓ Ready  ↓ Exporting  ↓ Exported  任何阶段 → Failed Failed → Retry / Resume
    Worker 必须把阶段性结果持久化，而不是所有结果只留在内存。这样 Worker 中断后可以重试或从最近阶段恢复。
11. Review 页面/移动端交互
    顶部：视频播放器 + 当前 Highlight 时间范围。
    Highlight 列表：缩略图、event time、start/end、confidence、选择状态。
    按 confidence 筛选/排序。
    播放单个 Highlight 时允许前后调整 Start/End。
    Delete 只改变 Highlight 状态，不删除原始视频。
    Select 后进入 Export。
    导出完成后展示保存/分享入口。
12. SSE / Processing Progress
    event: progress data: {"jobId":"job_123","stage":"Detecting","progress":32}  event: progress data: {"jobId":"job_123","stage":"Verifying","progress":68}  event: completed data: {"jobId":"job_123","status":"Ready"}
    MVP 也可以先用 polling 实现。因为 ProcessingJob 已经持久化，后续切换到 SSE 不需要改变核心业务模型。
13. Export 流程
    用户选择一个或多个 Highlight。
    Flutter 调用 POST /v1/exports。
    Node 创建 Export 记录并加入 export queue。
    Worker 根据 startTime/endTime 调用 FFmpeg。
    Individual Export 生成单独 MP4；Merge Export 按时间顺序 concat。
    输出上传到 Object Storage 私有 bucket。
    Node 更新 Export 为 Exported，并返回短期 Signed Download URL。
    Flutter 提供保存/分享入口。
14. Monorepo 本地开发
    docker compose up # postgres # redis # optional local object storage  # terminal 1 cd services/api pnpm dev  # terminal 2 cd services/ai-worker python -m app.worker  # terminal 3 cd apps/mobile flutter run
    本地开发时，建议先让 Python Worker 支持一个固定本地视频 fixture，避免每次验证 AI Pipeline 都需要从手机重新上传。
15. 测试策略
    AI：准备带人工标注 eventTime 的真实固定机位视频，记录 Recall、Precision、User Correction Rate。
    Worker：对 metadata、sampling、tracking、event clustering、FFmpeg trim/concat 做单元测试/集成测试。
    Backend：API、权限、Job 状态机、Signed URL、重试逻辑做集成测试。
    Flutter：Upload、Processing、Review、Export 做 widget/integration tests。
    E2E：至少建立一条“上传 → AI Job → Highlights → Export”的完整测试链。
16. 可观测性与失败恢复
    每个 Job 记录 model version、pipeline version、开始/结束时间、耗时、失败原因。
    Worker 每个阶段输出结构化日志。
    失败 Job 支持 retry，并避免重复生成 Highlight。
    对象存储采用 private bucket + Signed URL。
    原始视频和中间文件设置生命周期策略，降低长期存储成本。
    保留 AI 分析结果，用户重新进入 Review 页面不重复计算。
17. MVP 开发顺序
    Phase 0 — AI Feasibility：真实视频 → FFmpeg 抽帧 → Hoop ROI → Ball Detection → Tracking → Shot Candidate → Made Basket 初版 → 输出 JSON。
    Phase 1 — Backend Skeleton：PostgreSQL Schema、Node API、Object Storage、Job 状态机、Redis/BullMQ。
    Phase 2 — Flutter Upload：登录、Project、视频选择、Direct Upload、metadata、Calibration。
    Phase 3 — AI Integration：Node 创建 Job → Python Worker 消费 → 写回 Highlights → Flutter Processing 页面。
    Phase 4 — Review：Preview、Select、Delete、Start/End 调整、confidence filter。
    Phase 5 — Export：Individual Export、Merge Export、Signed Download/Save/Share。
    Phase 6 — Accuracy & Cost：候选筛选、Tracking、threshold、缓存中间结果、GPU/Inference 成本优化、Camera Profile。
18. 明确暂缓的工作
    不要第一阶段做复杂账号体系、支付、社交 Feed。
    不要先做专业级 Timeline Editor。
    不要先做球员身份识别。
    不要把整段视频逐帧送入昂贵的视觉模型。
    不要把 AI Worker 与 Node API 部署成同一个运行时。
    不要为了 Flutter 直接把大视频传到 Node。
    不要在 confidence 阈值没有真实数据验证前把 0.85/0.60 当成永久规则。
19. 关键产品指标
    Made Basket Recall：真实进球被发现的比例。
    Precision：生成 Highlight 中真正进球的比例。
    User Correction Rate：用户删除/修正 AI 结果的比例。
    Processing Cost / Hour。
    Processing Time / Hour。
    Time Saved：用户从传统人工剪辑到 AI 审核节省的时间。
    最重要的产品指标仍然是：用户是否从几十分钟人工剪辑降低到几分钟审核。
20. 最终技术栈

21. 最终架构原则
    Flutter 是用户体验层；Node 是业务控制层；Python 是 AI/视频计算层。
    原始视频永远优先 Direct Upload 到 Object Storage。
    长时间计算全部异步化。
    AI 负责发现候选，Human-in-the-loop 负责快速确认。
    AI Provider 必须通过接口隔离，方便未来替换本地模型、云端 inference 或自训练模型。
    所有关键中间结果持久化，支持重试、恢复和成本优化。
    先证明“1 小时视频 → 稳定找到进球 → 用户几分钟完成审核”成立，再扩大功能。

End of Architecture & Implementation Plan
