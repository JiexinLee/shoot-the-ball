# Shoot The Ball · 篮球高光智能剪辑

> **AI 驱动的篮球视频自动高光剪辑平台**：上传整场篮球录像 → YOLO 自动识别进球、三分、助攻、抢断、盖帽 → 自动生成短视频集锦 + 每个精彩瞬间独立短视频。

---

## 🏗️ 项目结构（Monorepo，pnpm workspace + turbo）

```
shoot-the-ball/
├── apps/
│   └── web/                    # Next.js 开发控制台 / 前端 Dashboard（黄黑主题）
├── services/
│   ├── api/                    # Node.js 后端 API（Fastify + Prisma + BullMQ）
│   └── ai-worker/              # Python AI Worker（YOLO + ffmpeg + RQ）
├── packages/
│   ├── contracts/              # TS 共享类型契约
│   └── storage/                # S3 / 本地存储抽象
├── assets/                     # 静态资源 / 测试视频
└── package.json                # workspace 根（scripts 速查见下）
```

---

## 🚀 快速开始

### 前置依赖

- **Node.js** ≥ 20
- **pnpm** ≥ 9（安装：`npm i -g pnpm`）
- **Python** ≥ 3.10 + **Poetry**（跑 `ai-worker` 时需要）
- **ffmpeg / ffprobe**（macOS：`brew install ffmpeg`）
- **Redis**（跑队列模式时需要，开发模式可不启）

### 首次安装依赖

```bash
pnpm install
```

---

## 🔥 Dashboard 控制台（你平时调前端用它）

**默认端口 3000**，被占时改 [apps/web/package.json](./apps/web/package.json) 里的 `-p 3000`。

| 命令                                         | 说明                                         |
| :------------------------------------------- | :------------------------------------------- |
| `pnpm dev:dashboard` （别名 `pnpm dev:web`） | **只启动 Web Dashboard，开发模式**（最常用） |
| `pnpm build:dashboard`                       | 构建生产包到 `.next/`                        |
| `pnpm start:dashboard`                       | 用生产包启动（需先 build）                   |
| `pnpm lint:dashboard`                        | 跑 ESLint                                    |
| `pnpm typecheck:dashboard`                   | tsc 类型检查（不生成产物）                   |

### Dashboard 功能一览

- 🎬 **拖拽 / 点击上传**任意视频（MP4 / MOV / MKV，单文件上限 8 GB，支持批量）
- 📊 **实时进度条**：上传中 → AI 分析中 → 已就绪（完整状态机）
- 🖼️ **视频卡片预览**：鼠标悬停自动播放片段
- ▶️ **预览弹窗**：全屏视频播放器 + 下载原文件 + ESC 关闭
- ⚠️ 超大文件自动标红报错
- 💡 开发阶段视频只在浏览器内存里预览，不会上传到任何服务器；接 API 后把 `apps/web/components/video-uploader.tsx` 里的 `startMockUpload` 换成真实 XMLHttpRequest 即可

---

## 🧠 后端 API（Node.js / Fastify）

| 命令                             | 说明                                                                     |
| :------------------------------- | :----------------------------------------------------------------------- |
| `pnpm dev:api`                   | 只启动后端 API（端口详见 `services/api`）                                |
| `pnpm build:api`                 | 构建 API 生产包                                                          |
| `pnpm db:generate`               | 跑 Prisma generate（根据 schema 生成 TS 类型）                           |
| `pnpm db:migrate`                | `prisma migrate dev`，执行未跑过的迁移                                   |
| `pnpm db:studio`                 | 开 Prisma Studio 看数据库                                                |
| `pnpm docker:up` / `docker:down` | 用 docker-compose 起本地 Postgres + Redis（生产推荐 Supabase + Upstash） |

---

## 🤖 AI Worker（Python）

详见 [services/ai-worker/README.md](./services/ai-worker/README.md)，常用命令：

```bash
cd services/ai-worker

# 本地开发装依赖（macOS/Windows 不用 CUDA）
poetry install --without cuda

# ① 本地调试模式（最快，不依赖 Redis/API）：直接处理本地视频，输出 highlights JSON
poetry run python -m app.worker --local-video /path/to/game.mp4

# ② 队列常驻模式：连 Redis 消费任务（需要先启动 Redis）
poetry run python -m app.worker

# ③ 一键跑 pipeline + 把 highlight 剪辑存本地某个目录（推荐调试剪辑用）
AI_DEMO_MODE=1 AI_DEMO_HIGHLIGHT_COUNT=5 \
  poetry run python tests/scripts/export_local_highlights.py \
    --video ../assets/testing-video.MP4 \
    --output-dir /tmp/clips-out \
    --merge
```

---

## 🧩 全栈一起跑

```bash
# Web Dashboard + API 同时启动（并行），开发阶段最常用
pnpm dev:all

# 整个 monorepo 所有 package 的 dev script 一起跑（新增 package 时用）
pnpm dev
```

---

## ☁️ MVP 阶段推荐云服务栈（可以零成本跑通）

| 模块            | 推荐服务                                                    | 为什么选它                                          |
| :-------------- | :---------------------------------------------------------- | :-------------------------------------------------- |
| PostgreSQL      | **Supabase**                                                | 免费层 500MB + 自带 Auth + Storage，性价比最高      |
| Redis / 队列    | **Upstash**                                                 | Serverless Redis，免费层每天 10,000 请求、10MB 存储 |
| 对象存储        | **Cloudflare R2**                                           | S3 兼容、**出口流量费 0 元**，免费 10 GB / 月       |
| AI 推理 (YOLO)  | 本地 M1/M2 → **Lambda Cloud 按需 GPU**                      | 本地开发免费；生产按需 A10/T4，~$0.5/h 起           |
| API 部署        | **Fly.io**                                                  | 免费层 3 个共享 CPU 实例，够 MVP                    |
| Web 部署        | **Vercel** (Hobby)                                          | Next.js 亲儿子，免费 Hobby 层够用                   |
| CDN / DNS / SSL | **Cloudflare 免费套餐**                                     | DDoS / CDN / WAF 全免                               |
| 日志监控        | **BetterStack (Logtail)** 免费层 + **Grafana Cloud** 免费层 | 前期 0 元                                           |

---

## 📦 所有 Scripts 速查

```bash
# —— Dashboard（前端）
pnpm dev:dashboard          # 开 Dashboard（你调试前端最常用）
pnpm build:dashboard
pnpm start:dashboard
pnpm lint:dashboard
pnpm typecheck:dashboard

# —— 后端
pnpm dev:api
pnpm build:api
pnpm db:generate / db:migrate / db:studio
pnpm docker:up / docker:down

# —— 全栈
pnpm dev:all                # Web + API 并行启动
pnpm dev                    # 整个仓库所有 package dev script
pnpm build / lint / test / clean
```

---

## 📂 下一步对接指南

- **从模拟上传 → 真上传**：改 [apps/web/components/video-uploader.tsx](./apps/web/components/video-uploader.tsx) 里的 `startMockUpload`，把内部的 setInterval 换成真实 `XMLHttpRequest`（带 `onprogress`）或者 fetch，其它 UI 代码一概不用动。
- **从 DEMO highlight → 真 YOLO 检测**：在 `services/ai-worker/app/detectors/` 三个 detector 子类里加载 YOLOv8 权重（`.pt` 文件），把返回空列表的 `detect_batch` 换成真推理；本地先保持 `AI_DEMO_MODE=1` 跑通端到端，再切真实模型。
- **生产环境变量模板**：参考 [services/ai-worker/.env.example](./services/ai-worker/.env.example)。
