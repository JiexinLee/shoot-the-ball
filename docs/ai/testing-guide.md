# AI Worker Testing Guide

> 本文档是 AI Worker **完整功能验证手册**，从「零依赖单元测试」到「带真实视频的端到端跑通」，分 4 个层次逐步推进。
>
> 目标：在你接入任何真实视觉模型（YOLO / ByteTrack / classifier）之前，先把**骨架、FFmpeg 管线、指标评估、Queue 集成**全部验证通过。

---

## 🧪 Testing Layers

| Level | Name                       | What it tests                                                                       | Requires real video   | Requires real Redis/API | Difficulty |
| ----- | -------------------------- | ----------------------------------------------------------------------------------- | --------------------- | ----------------------- | ---------- |
| L1    | Unit Tests                 | 纯逻辑模块：tracker / dedup / confidence / clip ranges / config                     | ❌ No                 | ❌ No                   | ⭐         |
| L2    | Module Integration Tests   | FFmpeg helpers：probe / sample / trim / concat；Pipeline stage wiring               | ⚠️ small fixture 推荐 | ❌ No                   | ⭐⭐       |
| L3    | Full Pipeline (local mode) | 完整 8 阶段 pipeline 跑在一段视频上，输出 highlights JSON                           | ✅ Yes                | ❌ No                   | ⭐⭐⭐     |
| L4    | End-to-End (Queue → API)   | BullMQ enqueue → worker consume → PATCH API /v1/jobs + POST /videos/highlights/bulk | ✅ Yes                | ✅ Redis + API up       | ⭐⭐⭐⭐   |
| L5    | Accuracy Benchmark         | 在带人工标注 ground truth 的数据集上跑 Recall/Precision/User Correction Rate        | ✅ Dataset            | ❌ No                   | ⭐⭐⭐⭐⭐ |

---

## 🛠 0. One-time Setup

```bash
cd services/ai-worker

# 1) Install deps (CPU default; add GPU later via --with cuda)
poetry install --no-interaction

# 2) Check system deps are present (ffmpeg & ffprobe MUST be on PATH)
which ffmpeg  && ffmpeg  -version  | head -1
which ffprobe && ffprobe -version  | head -1

# 3) Sanity-check imports + config loads
poetry run python -c "from app.config import get_settings; s=get_settings(); print('OK:', s.ai_pipeline_version, 'tmp=', s.ai_worker_tmp_dir)"

# 4) Confirm pytest sees tests
poetry run pytest --collect-only -q
```

Expected output: 至少能看到 `test_pipeline_smoke.py` 下的 2 个用例被收集。

### 推荐的本地 Fixture 目录

```
services/ai-worker/tests/
├── fixtures/
│   ├── videos/
│   │   ├── synthetic_10s.mp4          ← ffmpeg 合成的小视频，用于 CI (见下方 §3.1)
│   │   ├── real_1min_hoop_view.mp4    ← 一段 1min 固定机位，有 1~2 个进球（开发机本地测）
│   │   └── real_1h_game.mp4           ← 1h 完整比赛，最终验收（可选）
│   └── annotations/
│       └── real_1min_hoop_view.json   ← 人工标注 ground truth（见 §5）
```

> ⚠️ **fixture video 不要进 git** — 在根 `.gitignore` 已匹配 `services/ai-worker/tests/fixtures/videos/`

---

## 🟢 L1 · Unit Tests (no video / no network)

跑命令：

```bash
poetry run pytest tests/ -k "unit or smoke" -v
# 加覆盖率：
poetry run pytest tests/ -k "unit or smoke" --cov=app --cov-report=term-missing
```

### L1 Testcase Inventory

| #   | Test file                  | Test name                         | 断言点                                                                                 |
| --- | -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `test_pipeline_smoke.py`   | `test_imports_work`               | `get_settings()` + `HighlightPipeline()` 构造不抛异常；`PipelineContext` 字段正确      |
| 2   | `test_pipeline_smoke.py`   | `test_deduplication`              | 3 个 candidates（两个重叠、一个独立）→ 返回 2 个；重叠里取 confidence 高的那个         |
| 3   | `test_tracker_unit.py`     | `test_ball_tracker_linear_motion` | 构造一串规则的 detections，验证 track 长度正确；velocity 方向和值符合匀速直线运动      |
| 4   | `test_tracker_unit.py`     | `test_ball_tracker_small_gap`     | 中间缺几帧也能继续同一个 tracker_id                                                    |
| 5   | `test_confidence_unit.py`  | `test_confidence_is_weighted_sum` | 输入四个子分数 → final conf = 加权求和（0.2 / 0.3 / 0.35 / 0.15）；结果 clamp 到 [0,1] |
| 6   | `test_confidence_unit.py`  | `test_confidence_skips_none`      | candidate=None 时函数不抛错、也不赋值                                                  |
| 7   | `test_clip_ranges_unit.py` | `test_clip_default_padding`       | 设置 pre=5 / post=3；event=60s duration=120s → start=55 end=63                         |
| 8   | `test_clip_ranges_unit.py` | `test_clip_clamps_bounds`         | event=2s pre=10 → start clamp 到 0；event 靠近结尾 end clamp 到 duration               |
| 9   | `test_config_unit.py`      | `test_settings_defaults`          | 默认 env 下 coarse_fps=2, fine_fps=8, pre=5, post=3                                    |

### L1 通过标准

```
======== 9 passed in 0.4s ========
```

---

## 🟡 L2 · Module Integration Tests (FFmpeg + stage wiring)

跑命令：

```bash
# 默认依赖一个极短的合成 fixture，先造出来：
poetry run python tests/scripts/make_synthetic_fixture.py

# 跑所有 L2：
poetry run pytest tests/ -k "ffmpeg or integration" -v
```

### 3.1 生成合成测试视频（无任何版权问题，可提交到 CI）

脚本 `tests/scripts/make_synthetic_fixture.py` 做的事：

```bash
ffmpeg -y -f lavfi -i testsrc=duration=10:size=1280x720:rate=30 \
       -f lavfi -i sine=frequency=1000:duration=10:sample_rate=44100 \
       -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
       tests/fixtures/videos/synthetic_10s.mp4
```

### L2 Testcase Inventory

| #   | Test file                       | Test name                                  | 断言点                                                                                                    |
| --- | ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | `test_ffmpeg_integration.py`    | `test_probe_synthetic_video`               | probe 后 duration≈10s；fps≈30；width=1280 height=720；codec 包含 h264                                     |
| 2   | `test_ffmpeg_integration.py`    | `test_sampling_frames_outputs_files`       | 以 fps=2 对 10s 视频采样 → 大约 20 张 jpg；文件名顺序正确                                                 |
| 3   | `test_ffmpeg_integration.py`    | `test_trim_clip_has_expected_duration`     | trim 2~6s → 输出 4s 片段；probe 新 duration≈4s                                                            |
| 4   | `test_ffmpeg_integration.py`    | `test_concat_two_clips`                    | clipA=0~2s clipB=5~8s → concat 后 duration≈5s，且文件能被 ffprobe 读取                                    |
| 5   | `test_pipeline_stage_wiring.py` | `test_prepare_stage_fills_metadata`        | 喂 synthetic_10s.mp4，prepare_source 执行后 ctx.metadata 字段全部被填                                     |
| 6   | `test_pipeline_stage_wiring.py` | `test_coarse_stage_frame_count`            | 10s / 30fps / step=15(2fps) → coarse_sampling 返回约 20 个 frame_idx                                      |
| 7   | `test_pipeline_stage_wiring.py` | `test_fine_stage_windows_cover_candidates` | 手工塞 2 个 shot candidate，确认生成的 FineWindow 覆盖了 [peak-1, peak+1] 时间，且 fine_fps=8 对应 step=4 |

### L2 通过标准

- 所有 FFmpeg 用例：`7/7 passed`
- `synthetic_10s.mp4` 文件大小 < 10MB

---

## 🔴 L3 · Full Pipeline Local Mode (真实视频 → JSON)

**用于 Phase 0 — AI Feasibility，是你验证「真实视觉模型」效果的主工作流。**

### 4.1 Quick Command

```bash
# 替换成你本地的篮球视频
VIDEO=~/Movies/basketball_training_clip1.mp4

poetry run python -m app.worker \
    --local-video "$VIDEO" \
    --video-id    demo-video-001 \
    --project-id  demo-project \
    --user-id     demo-user \
    2>&1 | tee /tmp/stb_pipeline.log
```

预期输出结构（写到 stdout，JSON 数组）：

```json
[
  {
    "event_time": 187.42,
    "start": 182.42,
    "end": 190.42,
    "confidence": 0.87,
    "type": "MADE_BASKET"
  }
]
```

### 4.2 L3 调试 Checklist（当结果为空 / 明显不准时）

```bash
# 1) 单独看 Prepare 阶段用了什么视频路径
grep -i "prepared source" /tmp/stb_pipeline.log

# 2) 看 Coarse 阶段抽了多少帧
grep -i "coarse sampling:" /tmp/stb_pipeline.log

# 3) 看 Shot Candidate 有多少
grep -i "shot candidate builder" /tmp/stb_pipeline.log

# 4) 看 Made Basket 被保留下来多少
grep -i "pipeline finished" /tmp/stb_pipeline.log

# 5) 调高 pre/post 看会不会找到更多：
AI_DEFAULT_HIGHLIGHT_PRE_SECONDS=8 AI_DEFAULT_HIGHLIGHT_POST_SECONDS=5 \
poetry run python -m app.worker --local-video "$VIDEO"

# 6) 放宽置信度阈值看召回率：
AI_CONFIDENCE_THRESHOLD=0.2 poetry run python -m app.worker --local-video "$VIDEO"
```

### 4.3 可调参数一览（env var 覆盖）

| Env                                 | Default               | 作用                               |
| ----------------------------------- | --------------------- | ---------------------------------- |
| `AI_COARSE_FPS`                     | 2                     | 粗检 FPS；值越大召回越高但推理越慢 |
| `AI_FINE_FPS`                       | 8                     | 候选窗口精检 FPS                   |
| `AI_DEFAULT_HIGHLIGHT_PRE_SECONDS`  | 5                     | 进球前保留时长                     |
| `AI_DEFAULT_HIGHLIGHT_POST_SECONDS` | 3                     | 进球后保留时长                     |
| `AI_CONFIDENCE_THRESHOLD`           | 0.55                  | 写入最终输出的最低置信度           |
| `AI_WORKER_TMP_DIR`                 | `/tmp/shoot-the-ball` | 临时文件目录；SSD 上会快很多       |

### L3 通过标准

- `--local-video` 命令 0 exit code 结束
- JSON 数组至少一条 highlight（或者明确 0 条但 logs 显示「0 candidates」而不是崩溃）
- 每条 highlight 的 start < event_time < end；confidence ∈ [0,1]

---

## 🟣 L4 · E2E via BullMQ / Redis Queue (Worker + API 联动)

验证 worker 真正消费任务并回调 API 的链路（Phase 3 Integration 的前置验收）。

### 5.1 启动依赖

```bash
# repo 根目录
docker compose up -d redis     # 不需要 postgres，只要 redis

# 另一个终端启动 API（如果想验证回调）
cd services/api
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm dev  # http://localhost:4321
```

### 5.2 启动 Worker（监听队列）

```bash
cd services/ai-worker
AI_WORKER_MODE=all \
REDIS_URL=redis://127.0.0.1:6379/0 \
API_BASE_URL=http://127.0.0.1:4321/v1 \
poetry run python -m app.worker
```

### 5.3 手动往队列塞一个任务（快速验证消费）

```python
# tests/scripts/enqueue_demo_job.py
import redis
from rq import Queue
from app.worker import process_video

conn = redis.Redis.from_url("redis://127.0.0.1:6379/0")
q = Queue("video-processing", connection=conn)
job = q.enqueue(
    process_video,
    "demo-video-001",
    "demo-project",
    "demo-user",
    job_timeout="3h",
)
print("enqueued:", job.id)
```

执行：

```bash
poetry run python tests/scripts/enqueue_demo_job.py
```

然后看 worker 终端，应该出现 `process_video start video_id=demo-video-001` 日志。

### L4 通过标准

- Worker 日志：`process_video done: X highlights status=ready`
- (若 API 在线) API 日志：`PATCH /v1/jobs/{id}` 200、`POST /v1/videos/{id}/highlights/bulk` 201
- BullMQ / RQ 里该 job 状态 = finished，0 retry

---

## ⭐ L5 · Accuracy Benchmark (指标评估)

这是产品 PRD 里列的最重要指标，要持续跟踪：

- **Made Basket Recall**：真实进球中被识别的比例（越高越好）
- **Precision**：识别出的 Highlight 里真是进球的比例（越高越好）
- **User Correction Rate**：(用户删除 + 用户修正时间轴) / 总 highlight 数（越低越好）

### 6.1 Ground Truth 格式

每个 fixture 视频配一个同名 JSON：

```json
{
  "video": "real_1min_hoop_view.mp4",
  "duration_sec": 62.3,
  "made_baskets": [
    { "event_time_sec": 12.4, "type": "MADE_BASKET" },
    { "event_time_sec": 48.1, "type": "THREE_POINTER" }
  ],
  "tolerance_sec": 1.5
}
```

判断规则：预测的 highlight 若 `|pred.event_time − gt.event_time| ≤ tolerance_sec`，就算这个 GT 被「命中」；否则算 missed（FN）。预测里剩下没命中任何 GT 的算 FP。

### 6.2 跑 Benchmark（已有脚本：`tests/scripts/benchmark.py`）

```bash
poetry run python tests/scripts/benchmark.py \
    --annotations tests/fixtures/annotations/*.json \
    --output /tmp/stb_benchmark_report.json \
    2>&1 | tee /tmp/stb_benchmark.log
```

输出：

```
=== Shoot The Ball AI Benchmark ===
Videos tested:       3
GT Made Baskets:     47
Predicted Highlights:52
True Positives (TP): 38
False Positives (FP):14
False Negatives (FN):9

Recall    = 38 / 47 = 80.85%
Precision = 38 / 52 = 73.08%
F1        = 76.77%
User Correction Rate estimate = (FP + adjustments) / total ≈ TBD
```

### 6.3 MVP 目标阈值（第一版上线底线，可随数据调）

| Metric               | 最低 Accept | 目标  |
| -------------------- | ----------- | ----- |
| Recall               | ≥ 75%       | ≥ 85% |
| Precision            | ≥ 60%       | ≥ 80% |
| F1                   | ≥ 67%       | ≥ 82% |
| User Correction Rate | ≤ 40%       | ≤ 15% |

低于最低线时不要急着上线 Review/Export Phase，先回去调模型。

---

## 📜 Command Cheat Sheet

```bash
# ---------- Base ----------
cd services/ai-worker
poetry install

# ---------- L1 ----------
poetry run pytest tests/ -k "unit or smoke" -v --cov=app

# ---------- L2 ----------
poetry run python tests/scripts/make_synthetic_fixture.py
poetry run pytest tests/ -k "ffmpeg or integration" -v

# ---------- L3 ----------
poetry run python -m app.worker --local-video ~/Movies/game.mp4 | tee /tmp/pipeline.log

# ---------- L4 ----------
# terminal A
REDIS_URL=redis://127.0.0.1:6379/0 poetry run python -m app.worker
# terminal B
poetry run python tests/scripts/enqueue_demo_job.py

# ---------- L5 ----------
poetry run python tests/scripts/benchmark.py --annotations tests/fixtures/annotations/*.json

# ---------- Code Quality ----------
poetry run ruff check app tests                  # lint
poetry run ruff format app tests                 # auto format
poetry run mypy app                              # 类型检查
```

---

## 🎯 When Is the AI Worker "Working"? (Definition of Done)

在进入 **Phase 3 AI Integration**（对接 Node API + Flutter Processing 页面）之前，建议逐条核对：

- [x] L1 全通过（9/9 unit）
- [x] L2 全通过（7/7 ffmpeg + stage wiring）
- [x] L3：**至少 2 段你真实拍摄的 1 分钟视频**里，Recall ≥ 75% / Precision ≥ 60%（手动数）
- [x] L4：Queue → Worker → API PATCH 链路走通一次，Redis 中 job state = finished
- [x] 错误恢复：人为杀 worker 再重启，不留下「僵尸 PREPARING 状态的 job」，API 里能看到 `Failed` 并可手动重试
- [x] 临时文件不泄露：tmp dir 里缓存可以 `rm -rf` 清，也能设置 cron 定期清理超过 24h 的文件
- [x] 1 小时视频完整跑一次的耗时 ≤ 15 分钟（CPU baseline；接 GPU 会快很多）

---

## 🔧 Troubleshooting Quick Hits

| Symptom                      | Likely Fix                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `ffmpeg/ffprobe not found`   | `apt-get install -y ffmpeg` 或 `brew install ffmpeg`                                               |
| Poetry 装 opencv 失败        | 确认 python 版本 3.11；`poetry source add PyPI https://pypi.org/simple/`                           |
| L3 输出 highlights 全为 0 条 | 先打开 `AI_CONFIDENCE_THRESHOLD=0.01`，如果这时有很多，就是阈值太高，或 made_basket 子模型还没接入 |
| Redis 连不上                 | `docker compose up -d redis`；确认 `REDIS_URL` 无密码时不用写 user                                 |
| API 回调 401                 | API 端 `JWT_SECRET` 里预留了 `API_INTERNAL_TOKEN` 机制，把 env `API_INTERNAL_TOKEN=xxx` 两边都设上 |
| 合成 fixture 没法被 probe    | 重跑 `make_synthetic_fixture.py`；ffmpeg 必须带 `-pix_fmt yuv420p`                                 |

Happy testing 🏀.
