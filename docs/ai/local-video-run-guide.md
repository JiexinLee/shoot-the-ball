# 真实视频直接跑 AI — One-Page Guide

> 这是你唯一需要看的文档。就 4 步，任何视频都能 5 分钟内跑通并拿到 JSON。
>
> 目标：把你手机拍的一段篮球视频 → 扔进去 → 终端立刻打印出识别到的高光列表（时间、类型、置信度、建议 clip 区间）。

---

## 第 0 步：一次性装好环境（5 分钟）

```bash
# 1) 如果没有 Python 3.11、poetry、ffmpeg，先装这三个
brew install python@3.11 ffmpeg
curl -sSL https://install.python-poetry.org | python3 -

# 2) 进 AI Worker 目录装依赖
cd /Users/jiexinli/MyProjects/shoot-the-ball/services/ai-worker
poetry env use 3.11
poetry install

# 3) 验证装好了（不报错就是 OK）
poetry run python -c "from app.config import get_settings; print(get_settings().ai_pipeline_version)"
poetry run ffmpeg -version | head -1
```

---

## 第 1 步：准备一个视频

### 视频建议（识别效果最好的情况）
- **固定机位**（手机放三脚架、板凳上，镜头不移动）
- **球筐完整可见**，不要被人头挡住
- 时长 **10 秒 ~ 10 分钟**，太长也能跑但会慢
- 格式：iPhone / Android 直接录的 `.mp4` 或 `.mov` 都行

示例：`/Users/jiexinli/Movies/basketball_training.mp4`

### 就用合成演示视频（不需要你自己有视频）

```bash
poetry run python tests/scripts/make_synthetic_fixture.py
# 自动生成 tests/fixtures/videos/synthetic_10s.mp4，10 秒无版权
```

---

## 第 2 步：跑！只有一行命令

打开一个终端，**把最后一个参数改成你自己的视频路径**即可：

```bash
cd /Users/jiexinli/MyProjects/shoot-the-ball/services/ai-worker

AI_DEMO_MODE=1 \
poetry run python -m app.worker \
    --local-video "/Users/jiexinli/Movies/basketball_training.mp4"
```

> **说明**：`AI_DEMO_MODE=1` 这个开关是现在加的「演示模式」——因为 YOLO / 分类器等真实视觉模型还没接入，开这个开关会用一段伪识别逻辑（视频每 30s 生成 1 个进球 highlight，置信度 0.55~0.95）。  
> 以后真实模型接好了，**去掉 `AI_DEMO_MODE=1`** 就是真 AI。其他参数不用改。

### 想覆盖默认参数的可选开关

```bash
# 想自定义前后多少秒的片段、生成多少个 demo highlight：
AI_DEMO_MODE=1 \
AI_DEFAULT_HIGHLIGHT_PRE_SECONDS=8 \
AI_DEFAULT_HIGHLIGHT_POST_SECONDS=5 \
AI_DEMO_HIGHLIGHT_COUNT=6 \
poetry run python -m app.worker --local-video /path/to/video.mp4 \
    --video-id    clip_20260922_001 \
    --project-id  weekend_training \
    --user-id     jiexin
```

| 变量 | 默认 | 作用 |
| ---- | ---- | ---- |
| `AI_DEFAULT_HIGHLIGHT_PRE_SECONDS` | 5 | 高光开始前留多少秒 |
| `AI_DEFAULT_HIGHLIGHT_POST_SECONDS` | 3 | 高光结束后留多少秒 |
| `AI_DEMO_HIGHLIGHT_COUNT` | 自动（≈每 30s 1 个） | Demo 模式下强制生成几个 |

---

## 第 3 步：看结果（最终 JSON 直接打印在终端末尾）

正常跑完你会看到类似：

```json
[
  {
    "event_time": 18.2,
    "start": 13.2,
    "end": 21.2,
    "confidence": 0.89,
    "type": "MADE_BASKET"
  },
  {
    "event_time": 54.7,
    "start": 49.7,
    "end": 57.7,
    "confidence": 0.73,
    "type": "THREE_POINTER"
  }
]
```

### 字段含义（导给 Review 页面用的就是这 4 个值）

| 字段 | 含义 | 时间单位 |
| ---- | ---- | -------- |
| `event_time` | 球穿过篮网那一刻（核心事件时间） | 秒，视频开头=0 |
| `start`      | 建议裁剪片段的开始（event - 5s 默认） | 秒 |
| `end`        | 建议裁剪片段的结束（event + 3s 默认） | 秒 |
| `confidence` | 置信度 0~1，越高越可能是真进球 | 无单位 |
| `type`       | `MADE_BASKET` / `THREE_POINTER` / ASSIST / STEAL / BLOCK / REBOUND | 枚举 |

### 想看更详细的阶段日志？

跑命令后面加 `| tee /tmp/stb.log`，把日志存到一个文件里，然后：

```bash
grep -E "\[progress\]|stage|Pipeline finished|error" /tmp/stb.log
```

会打印这样的进度：

```
[progress] stage=prepare progress=0.00%
[progress] stage=detecting progress=0.55%
[progress] stage=verifying progress=0.85%
[progress] stage=generating_clips progress=1.00%
INFO Pipeline finished: 6 highlights
```

---

## 🔥 常见坑 & 快解

| 现象 | 立刻做什么 |
| ---- | ---------- |
| 报 `poetry env use 3.11` 找不到 Python | `poetry env use /usr/local/bin/python3.11`（M1 Mac 一般在 `/opt/homebrew/bin/python3.11`） |
| 报 `ffmpeg/ffprobe not found` | `brew install ffmpeg` |
| `Permission denied` 读取视频 | 把视频拖到 `services/ai-worker/tests/fixtures/videos/` 里再跑本地路径 |
| 跑完 JSON 是 `[]`（空数组） | **必须加 `AI_DEMO_MODE=1`**！现在真实视觉模型还没接上，不加就是 no-op |
| 超长视频跑太久 | 先剪 1~2 分钟片段：`ffmpeg -i long.mp4 -ss 00:02:00 -t 00:02:00 -c copy short.mp4` |
| M1/M2 Mac 跑 ultralytics 慢 | **当前是 Demo 模式，不用装 ultralytics**；接入真模型再说 |

---

## 📌 接入真实视觉模型后怎么切换？

当 `detectors/` 里真正装了 YOLO 与 classifier 后：

```diff
- AI_DEMO_MODE=1 \
  poetry run python -m app.worker --local-video /path/to/video.mp4
```

就去掉 `AI_DEMO_MODE=1` 这一行，其他完全不变。命令是同一个，只是内部逻辑走真模型了。

---

## 🔜 完成后下一步能做什么？（可选，看你心情）

1. **把输出保存成 JSON 文件**：在命令末尾加 `> highlights.json`
2. **真正从 Redis Queue 消费任务**：按 testing-guide L4，`docker compose up -d redis` 开另一个终端起 worker，再 `enqueue_demo_job.py` 塞任务
3. **把结果 POST 回 Node API**：等 API 的 `/videos/:id/highlights/bulk` 端点落地后，把 JSON 直接发过去就能在 Flutter Review 页看视频了

Over — 现在就去跑吧 🏀.
