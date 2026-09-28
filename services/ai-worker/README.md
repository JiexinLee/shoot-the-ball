# Shoot The Ball — AI Worker (Python)

> 基于 **Python 3.12 + Poetry 2 + YOLOv8 + OpenCV + SORT/Bot-SORT + FFmpeg** 构建的「篮球视频 AI 分析引擎」。它不对外暴露 HTTP 端口，而是作为一个**常驻后台 Worker 进程**：
> 从 Redis 队列（`video-processing`）里消费 API 发过来的任务 → 跑 8 阶段 Pipeline 分析视频 → 通过 `X-Internal-Token` 鉴权头回写 Node.js API（PATCH 进度 / POST 批量 Highlights）。

---

## 1. 这个服务在整个系统里的位置

```
┌─────────────────┐        ┌─────────────────────┐        ┌────────────────────────┐
│  Next.js Web    │  HTTPS │  Node.js API (4000)  │  Redis │  Python AI Worker (本项目) │
│  (用户上传视频)   │───────►│  (业务控制 / 状态机)  │──────►│                        │
│                 │        │  · 鉴权              │        │  · 下载视频到 /tmp      │
│  SSE 进度 ←──────│◄──────│  · SSE 长连接推进度   │◄──────│  · YOLOv8 检测球员/球   │
└─────────────────┘        │  · BullMQ 入队        │  HTTPS │  · 轨迹追踪 + 进球判定   │
                           └─────────────────────┘        │  · FFmpeg 剪片段         │
                                                          │  · PATCH 进度写回 API     │
                                     Cloudflare R2 ◄──────│  · POST Highlights 写回   │
                                     (对象存储)             └────────────────────────┘
```

**关键设计原则（必须理解）：**
1. **AI Worker 和 Node API 是两个完全独立的进程 / 容器**，绝不混布。API 是业务控制层，Worker 是纯计算层。
2. **Worker 不对外监听任何端口**，它只做两件事：(a) 从 Redis BLPOP 拉任务；(b) 主动发 HTTP 请求回 Node API（PATCH 进度、POST highlights）。这样被攻击面 = 0。
3. **跨服务写操作必须带 `X-Internal-Token` 自定义头**（不是 JWT），值在两端 `.env.local` 里必须字节级完全一致。这是 Hard Constraint。
4. **原始视频走 Direct Upload（R2 预签名 URL），永远不经过 Node API 中转**，也不经过 Worker 的入口网络——Worker 自己用 S3 SDK 从 R2 `get_object` 下载到 `/tmp` 本地处理。

---

## 2. 本地启动 / 调试入口（3 种模式）

### 模式 A：**推荐先用这个跑通链路** — 本地视频直接跑 Pipeline（不经过 Redis / Node API）

```bash
cd services/ai-worker
poetry install --no-interaction

# 用 assets/testing-video.MP4 跑 DEMO 模式（不加载 YOLO，省时间）
AI_DEMO_MODE=true \
poetry run python -m app.worker \
  --local-video ../../assets/testing-video.MP4 \
  --output-dir ./tmp_out \
  --skip-upload

# ✅ 跑完去看 ./tmp_out/：
#    highlights.json  ← 所有进球候选（startTime/endTime/confidence）
#    clips/*.mp4      ← 剪好的单个片段（如果没 --skip-upload 的话）
```

> **为什么推荐先跑这个？** 因为它没有外部依赖（不需要 Postgres / Redis / Node API 全跑），纯 Python + FFmpeg 就能验证 Pipeline 本身有没有炸。先把最简单的跑通，再一层层往外接。

---

### 模式 B：**队列消费模式**（和生产一致，需要 Redis + Node API 都先启动）

```bash
# 前置：先在根目录启动基础设施 + API（另开 2 个终端）
#   Terminal 1 (根目录):  docker compose up -d postgres redis
#   Terminal 2 (services/api): pnpm dev

# 然后启动 Worker（常驻进程，监听 Redis queue）
cd services/ai-worker
poetry run python -m app

# 预期启动日志：
#   [2026-xx-xx xx:xx:xx] INFO Starting AI Worker ...
#   [2026-xx-xx xx:xx:xx] INFO Listening to queues: ['video-processing', 'video-export']
#   (之后阻塞，等 API 端有人 POST /v1/videos/:id/process 才会有任务进来)
```

手动塞 1 个任务进队列（不用等 Web / curl 跑全链路）：
```bash
cd services/ai-worker
poetry run python tests/scripts/enqueue_demo_job.py
```

---

### 模式 C：**真模型模式**（关闭 DEMO，真实跑 YOLOv8 + MPS 加速）

```bash
cd services/ai-worker

# 先做一次 MPS warmup（第一次会下载 6MB yolov8n.pt + 编译 Metal shader，可能 10~20s）
poetry run python3 << 'PYEOF'
from ultralytics import YOLO
import torch
import numpy as np

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"Using device: {device}")
model = YOLO("yolov8n.pt")
dummy = np.zeros((1, 3, 640, 640), dtype=np.uint8)
_ = model(dummy, device=device, verbose=False)
print("✅ YOLOv8 warmup done")
PYEOF

# 然后正常跑 local-video（这次没 AI_DEMO_MODE=true）
poetry run python -m app.worker --local-video ../../assets/testing-video.MP4 --output-dir ./tmp_out
```

---

## 3. 目录结构详解（对应任务 1.1.1 要求你理解每个文件夹做什么）

```
services/ai-worker/
├── app/                              # 主源码目录（Python package）
│   ├── __main__.py                   # `python -m app` 入口：解析 CLI → 起 Worker（模式 B）
│   ├── worker.py                     # ⭐ 核心调度：Redis BLPOP 循环 + 调 Pipeline + 回写 API
│   ├── config.py                     # Pydantic Settings：所有 env 变量读取 + 默认值（对应 .env.local）
│   ├── logging_setup.py              # loguru 配置：开发彩色 / 生产 JSON
│   ├── types.py                      # ⭐ 全局数据结构（dataclass）：PipelineContext / Detection / TrackedObject 等
│   │
│   ├── ffmpeg/                       # ⭐ 最底层工具层（先吃透，再往上）
│   │   ├── metadata.py               # probe_video() → ffprobe 拿 fps / width / duration / codec
│   │   ├── sampling.py               # 帧采样：按均匀间隔 / 指定 frame_indices 抽帧 → numpy 数组
│   │   ├── trim.py                   # trim_video_seconds(input, start, end, output) → FFmpeg -ss -t 剪片段
│   │   └── concat.py                 # concat_videos([f1,f2,...], out) → FFmpeg concat demuxer 拼接
│   │
│   ├── detectors/                    # ⭐ YOLOv8 目标检测（3 个子类 + 共享单例模型权重）
│   │   └── player_detector.py        # BaseDetector + PlayerDetector (COCO person class 0)
│   │                                 #                + BallDetector   (COCO sports ball class 32)
│   │                                 #                + HoopDetector   (COCO 没篮筐 → fallback 用户给的 hoop_roi)
│   │                                 # _YOLOManager 是模块级单例：3 个 Detector 共享 1 份 yolov8n.pt，省内存
│   │
│   ├── tracking/                     # ⭐ 多目标追踪：把散点 Detection 串成连续轨迹（track_id）
│   │   └── ball_tracker.py           # SORT / Bot-SORT 两种算法可切换：防 ID switch
│   │
│   ├── events/                       # ⭐ 核心业务逻辑：从轨迹 + 检测结果里找到「进球事件」
│   │   ├── possession.py             # 球权判断：球离哪个 player bbox 最近就算谁持球
│   │   ├── shot_candidate.py         # 候选窗口提取：抛物线 + 靠近篮筐 → 触发 ShotCandidate
│   │   ├── made_basket.py            # 真实验证：球穿过篮筐平面 → 继续下落 → 篮框内消失 → Made Basket
│   │   ├── confidence.py             # 分项打分（轨迹平滑度 / 与篮筐距离 / 消失时机 …）→ 综合 confidence 0~1
│   │   ├── deduplication.py          # NMS / 时间聚类：防止 1 个进球被连续 3 帧各判 1 次产生重复
│   │   └── demo_highlights.py        # AI_DEMO_MODE=true 时，生成假 highlights 跳过真模型
│   │
│   ├── clips/                        # ⭐ 进球片段生成器（默认只产索引，导出时才真 FFmpeg）
│   │   └── highlight_generator.py    # eventTime 前 5s + 后 3s（可调）→ startTime/endTime
│   │
│   └── pipeline/                     # ⭐ 8 阶段主流程串起来（Phase 0~7，下节详解）
│       ├── prepare.py                # Stage 0: ffprobe metadata + 校验可读性 + 下载 R2 → 本地 /tmp
│       ├── coarse.py                 # Stage 1: 低 FPS 粗采样 + 快速扫一遍有没有球靠近篮筐的候选区域
│       ├── fine.py                   # Stage 3~6: 候选区域提采样率 → verify + confidence + dedup
│       └── pipeline.py               # ⭐ 大总管：依次 run(ctx) → 调用每个 stage → 汇总出 highlights
│
├── tests/                            # 单元 / 集成测试（可按阶段选择性跑）
│   ├── fixtures/
│   │   ├── annotations/_template.json  # 手标进球时间戳的 fixture 模板，算 Recall/Precision 用
│   │   └── videos/README.md            # 把测试视频放这里（被 gitignore 了，不会上传）
│   ├── scripts/
│   │   ├── benchmark.py                # 用标注数据算 AI 指标（Recall / Precision）
│   │   ├── enqueue_demo_job.py         # 往 Redis 塞 1 个假任务（测 Worker 消费）
│   │   ├── export_local_highlights.py  # 本地跑完全部 highlights 并真的用 FFmpeg 剪出来看效果
│   │   └── make_synthetic_fixture.py   # 生成合成视频/合成检测数据，测 pipeline 不靠真实视频
│   ├── test_config_unit.py           # config / env 解析单元测试
│   ├── test_ffmpeg_integration.py    # metadata / trim / concat 集成测试（依赖本地 FFmpeg）
│   ├── test_tracker_unit.py          # SORT tracker 单测（用合成 detection 不依赖视频）
│   ├── test_confidence_unit.py       # confidence 打分单测
│   ├── test_clip_ranges_unit.py      # startTime/endTime 范围计算单测
│   ├── test_pipeline_stage_wiring.py # 检查 8 个 stage 有没有正确串起来（不跑真视频）
│   └── test_pipeline_smoke.py        # 烟雾测试：极短视频（10s）跑全流程，确保没 crash
│
├── pyproject.toml                    # Poetry 配置：Python 3.12 + 所有依赖版本
├── .env.example                      # ⚠️ .env.local 模板（复制后填真实值，严禁提交带 secret 的版本）
├── Dockerfile                        # 生产镜像：slim 基础镜像 + Poetry 非 root 用户
└── README.md                         # ⬅ 本文件
```

---

## 4. ⭐ 8 阶段 Pipeline（任务 1.1.1 要求你画流程图 + 口述输入输出）

> 这是整个 AI Worker 的灵魂。**每一个阶段的输出都会写进 PipelineContext，下一阶段只读 PipelineContext，不跨阶段直接传参。** 这样做的好处是 Worker 崩溃后可以从最近完成的阶段 resume，不用重跑全流程。

| Stage # | 名称（对应 ProcessingJob.stage 值） | 做什么 | 输入（读 PipelineContext 的字段） | 输出（写 PipelineContext 的字段） | 大约占总进度 |
|---------|------------------------------------|--------|-----------------------------------|-----------------------------------|-------------|
| **0** | **Preparing** | 1. 从 R2 下载源视频到 `/tmp`（或者 `--local-video` 直接用本地路径）<br/>2. `ffprobe` 拿 fps / width / height / duration / codec<br/>3. 校验视频可读（corrupt 的直接抛错 FAILED） | `storageKey` / `local_video_path` | `video_path` / `fps` / `width` / `height` / `total_frames` / `duration_sec` | 0 ~ 5% |
| **1** | **Coarse Sampling**<br/>(→ stage 文案变 "Detecting") | 1. **低 FPS 均匀抽帧**（比如原视频 30fps → 抽 2fps，处理量直接砍到 1/15，省钱关键）<br/>2. 如果用户给了 `hoop_roi`（校准页面画的篮筐框），只用 ROI 区域做检测，再砍 ~80% 计算量 | `video_path` / `fps` / `hoop_roi`（可选） | `coarse_frames` (list[numpy]) / `coarse_frame_indices` / `coarse_timestamps` | 5 ~ 15% |
| **2** | **Candidate Detection**<br/>(Detecting 继续) | 1. PlayerDetector / BallDetector 跑一遍 coarse 帧<br/>2. BallTracker.update(detections) → 得到球的轨迹（track_id 连续）<br/>3. 基于：**球突然向上 → 抛物线顶点 → 靠近 hoop bbox** → 提取出若干个 **时间候选窗口**（比如 "第 42s~48s 之间有一次投篮嫌疑"） | `coarse_frames` / `coarse_detections_*` | `ball_tracks` / `player_detections_by_frame` / `shot_candidate_windows[]` (每个 candidate 有 start/end 秒) | 15 ~ 60% |
| **3** | **Fine Verification**<br/>(→ stage 变 "Verifying") | **只对每个 ShotCandidate 的时间窗口提采样率**（粗采样 2fps → 精采样 15fps）。做：<br/>1. 球的精细轨迹<br/>2. 与篮筐平面的交点（穿过了吗？）<br/>3. 球继续下落 + 在篮筐区域内短暂消失（空心/擦板进球的典型特征） | `shot_candidate_windows[]` | `verified_candidates[]`（每个有 `is_made_basket: bool` + 分项证据） | 60 ~ 85% |
| **4** | **Confidence Scoring**<br/>(Verifying 继续) | 分项打分 → 综合 confidence（0~1）：<br/>- 抛物线平滑度（球有没有突然瞬移，没有说明是真实球不是误检）<br/>- 球与篮筐中心的最小距离<br/>- 球消失的时机（是否刚好在穿过篮筐平面后）<br/>- user 给没给 hoop_roi（给了的加基础分） | `verified_candidates[]` 的证据字段 | 每个 candidate 写入 `confidence` + `metadata{ sub_scores }` | 85 ~ 90% |
| **5** | **Deduplication**<br/>(Verifying 继续) | 事件聚类去重：<br/>同一个进球可能被 Coarse 阶段连续 2~3 帧各触发一次候选，最终产生 startTime 相差 0.2s 的 3 条记录。<br/>做法：IoU ≥ 0.7 或 时间差 < 1.5s 的 N 条合并，取 confidence 最高的那条保留 | `verified_candidates[]`（含重复） | `deduplicated_candidates[]`（去重后） | 90 ~ 93% |
| **6** | **Clip Generation (Index)**<br/>(→ stage 变 "GeneratingClips") | **注意：MVP 阶段这里不真跑 FFmpeg**（省存储 + 省时间）。<br/>只生成索引：<br/>`startTimeSec = eventTimeSec - 5s`（进球前 5 秒）<br/>`endTimeSec   = eventTimeSec + 3s`（进球后 3 秒）<br/>真的剪视频等用户点 Export 的时候再做。 | `deduplicated_candidates[]` | `highlights[]`（每条有 startTime/endTime/eventTime/confidence/type=MADE_BASKET） | 93 ~ 99% |
| **7** | **Persist**<br/>(→ READY / FAILED) | 1. `POST /v1/videos/:id/highlights/bulk`（带 X-Internal-Token）批量写回 Node API<br/>&nbsp;&nbsp;→ 后端事务两阶段：先软删该 video 所有旧 highlights → 再 createMany 新的<br/>2. `PATCH /v1/jobs/:id` 把 status=READY progress=1.0<br/>（如果中间任一步抛异常就 PATCH status=FAILED + errorMessage） | `highlights[]` | API 端 DB 落库成功；PipelineContext 全部持久化完成 | 99 ~ 100% |

**Pipeline 执行伪代码（在 `pipeline/pipeline.py` 里）：**
```python
ctx = PipelineContext(video_id=..., storage_key=...)

ctx = prepare_stage.run(ctx)        # Stage 0
ctx = coarse_stage.run(ctx)         # Stage 1~2
ctx = candidate_detection.run(ctx)  # Stage 2 (cont.)
ctx = fine_stage.run(ctx)           # Stage 3
ctx = confidence.run(ctx)           # Stage 4
ctx = dedup.run(ctx)                # Stage 5
ctx = clip_generator.run(ctx)       # Stage 6
ctx = persist_stage.run(ctx)        # Stage 7

return ctx.highlights
```

---

## 5. 关键类型（types.py，1.1.4 要口述字段含义）

> 核心 5 个 dataclass，理解了它们就等于理解了 Pipeline 90% 的数据流向。

### 5.1 `PipelineContext` —— 贯穿 8 个 Stage 的「共享黑板」
```python
@dataclass
class PipelineContext:
    # ----- 输入（来自 Job payload）-----
    video_id: str                      # DB Video.id
    project_id: str                    # DB Project.id
    user_id: str                       # DB User.id（只用于日志打 tag，不用于鉴权）
    storage_key: Optional[str]         # R2 源视频路径，模式 B 才有
    local_video_path: Optional[str]    # --local-video 模式的本地路径
    hoop_roi: Optional[Roi]            # 用户校准页面画的篮筐 ROI（可选，给了就快很多）

    # ----- Stage 0 产出 -----
    video_path: Optional[str] = None   # 本地 /tmp 下的绝对路径（ffmpeg 直接读这个）
    fps: float = 0.0
    width: int = 0
    height: int = 0
    total_frames: int = 0
    duration_sec: float = 0.0

    # ----- Stage 1 产出（Coarse）-----
    coarse_frame_indices: list[int] = field(default_factory=list)   # 抽了哪些帧（帧号）
    coarse_timestamps:   list[float] = field(default_factory=list)  # 对应秒数
    coarse_frames:       list = field(default_factory=list)         # numpy BGR 图片数组

    # ----- Stage 2 产出（Detection + Tracking）-----
    ball_detections_by_frame:   dict[int, list[Detection]] = field(default_factory=dict)
    player_detections_by_frame: dict[int, list[Detection]] = field(default_factory=dict)
    hoop_detections_by_frame:   dict[int, list[Detection]] = field(default_factory=dict)
    ball_tracks: list[TrackedObject] = field(default_factory=list)   # 连续轨迹

    # ----- Stage 2~5 产出 -----
    shot_candidate_windows: list = field(default_factory=list)    # 候选时间窗口
    verified_candidates:   list = field(default_factory=list)     # 精细验证后的进球（可能含重复）
    deduplicated:          list = field(default_factory=list)     # 去重后的进球

    # ----- Stage 6 产出（最终结果）-----
    highlights: list = field(default_factory=list)  # 每个元素是 Highlight 结构
```

### 5.2 `Detection` —— 单帧单次目标检测结果
```python
@dataclass
class Detection:
    frame_idx: int                # 第几帧
    timestamp_sec: float          # 对应秒数
    bbox: tuple[float, float, float, float]  # (x1, y1, x2, y2) 绝对像素坐标，左上右下
    score: float                  # YOLO confidence 0~1
    label: str                    # "ball" / "player" / "hoop"
```

### 5.3 `TrackedObject` —— SORT 追踪器输出的「连续轨迹」
```python
@dataclass
class TrackedObject:
    track_id: int                 # 同一条球/球员的连续 id，没跳就是同一个物体
    detections: list[Detection]   # 这条轨迹对应的所有帧 detection
    # 工具属性：
    @property
    def first_seen(self) -> float: ...  # 首次出现秒数
    @property
    def last_seen(self)  -> float: ...  # 消失秒数
```

### 5.4 `Roi` —— 用户校准画的区域
```python
@dataclass
class Roi:
    x: int        # 左上角 X（像素）
    y: int        # 左上角 Y
    width: int    # ROI 宽
    height: int   # ROI 高
```

### 5.5 `HighlightCandidate` —— 最终要写回 DB 的一条进球
```python
@dataclass
class HighlightCandidate:
    start_time_sec: float         # 片段开始（eventTime 前 5s）
    end_time_sec: float           # 片段结束（eventTime 后 3s）
    event_time_sec: float         # 真正进球那一刻的时间戳（用于排序 + UI 显示）
    confidence: float             # 综合 confidence 0~1
    highlight_type: str           # "MADE_BASKET" 固定，以后扩展 ASSIST/STEAL/...
    metadata: dict                # 扩展字段：子项评分 / bbox 快照 / 模型版本，想塞啥塞啥
```

---

## 6. Env 变量一览（.env.local 需要配置的）

对应任务 0.4。**两端 API_INTERNAL_TOKEN 必须字节级一致**。

| 变量名 | 必填 | 示例值 | 说明 |
|--------|------|--------|------|
| `PYTHON_ENV` | 否 | `development` | 决定 loguru 彩色还是 JSON |
| `LOG_LEVEL` | 否 | `INFO` / `DEBUG` | 开发 DEBUG 可以看每个 frame 的检测 |
| `API_BASE_URL` | **是** | `http://127.0.0.1:4000/v1` | Node API 的内部地址（回写 PATCH/POST 用） |
| `API_INTERNAL_TOKEN` | **是** | 长随机字符串 | ⚠️ Hard Constraint：必须和 `services/api/.env.local` 里完全一样 |
| `REDIS_URL` | **是** | `redis://default:xxx@127.0.0.1:6379/0` | 本地 docker 或 Upstash，队列在哪里就指哪里 |
| `QUEUE_PROCESSING_NAME` | 否 | `video-processing` | 和 Node 端 BullMQ 同一个 Redis key，不要改 |
| `QUEUE_EXPORT_NAME` | 否 | `video-export` | 同上 |
| `STORAGE_PROVIDER` | **是** | `s3` / `r2` | 两个都可以，MinIO 也是 S3 兼容 |
| `STORAGE_ENDPOINT` | **是** | R2 就填 Cloudflare 给的；本地 MinIO 就 `http://127.0.0.1:9000` | S3 官方 AWS 留空 |
| `STORAGE_REGION` | **是** | R2 填 `auto`；MinIO 随便填 `us-east-1` | |
| `STORAGE_ACCESS_KEY_ID` | **是** | R2 / MinIO 的 Access Key | |
| `STORAGE_SECRET_ACCESS_KEY` | **是** | R2 / MinIO 的 Secret Key | |
| `STORAGE_BUCKET_SOURCE` | 否 | `shoot-the-ball-source` | 源视频桶，和 API 端一致 |
| `STORAGE_BUCKET_EXPORTS` | 否 | `shoot-the-ball-exports` | 导出桶，和 API 端一致 |
| `AI_TORCH_BACKEND` | 否 | `auto` / `mps` / `cpu` / `cuda` | auto 会按 MPS→CUDA→CPU 顺序探测 |
| `AI_CONFIDENCE_THRESHOLD` | 否 | `0.25`（默认） | YOLO 单帧 detection 的最小置信度，调太低 = 误检多；调太高 = 漏检多 |
| `AI_DEMO_MODE` | 否 | `true` / 留空 | 开发阶段设 true：跳过 YOLO 直接假数据，省 99% 时间 |
| `TEMP_DIR` | 否 | `/tmp` | 下载源视频 + 中间帧的目录，本地可改 `./tmp` 方便看 |

---

## 7. 调试小抄 & 常见坑

### Q1: `ERROR    Failed to load yolov8n.pt` 或下载权重卡
**Fix**: 手动下权重到缓存目录：
```bash
mkdir -p ~/.cache/ultralytics
curl -L -o ~/.cache/ultralytics/yolov8n.pt \
  https://github.com/ultralytics/assets/releases/download/v8.1.0/yolov8n.pt
```

### Q2: MPS 下第一次跑 PyTorch 特别慢（10~30s 没动静）
不是卡了，是第一次运行在**后台编译 Metal shader**（MPS 的 JIT 特性）。跑完一次后会缓存到 `~/Library/Application Support/`，后续就秒开了。

### Q3: `ffprobe` 报 "File ended before MOOV atom" — 视频上传了一半 / corrupt
解决：上传阶段客户端 PUT 没完成就别调 complete。API 端的 `POST /v1/videos/:id/complete` 必须 HeadObject 校验真实 sizeBytes，这是 Hard Constraint。

### Q4: AI Worker 发 `PATCH /jobs/:id` 老是 403 Forbidden
99% 的情况是 **两端 `API_INTERNAL_TOKEN` 不一致**。用 0.3 / 0.4 的 env probe 命令分别查 API 端和 Worker 端的 token 前 8 个字符，必须完全相同。

### Q5: BallDetector 老检测不到球（球太小 / 分辨率太低）
两个办法：
1. MVP 建议**用户上传前把视频缩放到 720p 以上**（在 Web 端用 ffmpeg.wasm 做，或者文档里提醒）
2. 调低 `AI_CONFIDENCE_THRESHOLD` 从 0.25 → 0.15，配合 dedup 阶段去误检
3. 后续 Phase 6 做专门的 basketball-scene 微调模型（COCO 的 "sports ball" 是通用球类，篮球识别不稳定）

---

## 8. 常用开发命令

```bash
cd services/ai-worker

# 1) 安装依赖
poetry install --no-interaction

# 2) Lint（和 CI 同款，提交前必须过）
poetry run ruff check app tests

# 3) 单元测试（pytest）
poetry run pytest tests/ -q                                    # 全部
poetry run pytest tests/test_tracker_unit.py -q                # 单个模块
poetry run pytest tests/test_pipeline_smoke.py -q -s           # 烟雾测试 + 看 stdout

# 4) 本地 DEMO 跑完整 Pipeline（最快，不依赖任何外部服务）
AI_DEMO_MODE=true poetry run python -m app.worker \
  --local-video ../../assets/testing-video.MP4 \
  --output-dir ./tmp_out --skip-upload

# 5) 真模型跑（MPS/CPU，有 YOLO 预热）
poetry run python -m app.worker --local-video ../../assets/testing-video.MP4 --output-dir ./tmp_out

# 6) 用标注数据算 Recall / Precision（Phase 5 验收用）
poetry run python tests/scripts/benchmark.py --fixtures tests/fixtures/annotations/

# 7) 本地真的把每个 highlight 剪成 mp4 打开看（调试检测准不准）
poetry run python tests/scripts/export_local_highlights.py \
  --input ../../assets/testing-video.MP4 --json ./tmp_out/highlights.json --out ./tmp_out_clips
```
