# 🏀 Shoot The Ball — AI Basketball Highlight Generator

利用 AI 自动识别篮球比赛/训练视频中的进球事件，自动生成高光短片，让用户从几十分钟的人工剪辑降低到几分钟审核。

- **Mobile-First (Flutter)**：选视频 → 上传 → AI 分析 → Review → 导出
- **Node.js + TypeScript (Express)**：认证、项目、Signed URL、Job 编排、客户端 API
- **Python AI Worker**：FFmpeg + OpenCV + YOLO 检测、Tracking、Shot Candidate、Made Basket 分类、Highlight 生成
- **PostgreSQL (Neon)** + **Redis / BullMQ** + **S3-compatible Object Storage**

---

## 📁 Monorepo Layout

```
shoot-the-ball/
├── apps/
│   └── mobile/               # Flutter (iOS / Android)
├── services/
│   ├── api/                  # Express + TypeScript + Prisma
│   │   ├── prisma/           # PostgreSQL schema + migrations
│   │   ├── src/config/       # env, logger
│   │   ├── src/db/           # Prisma client
│   │   ├── src/modules/      # auth / projects / videos / jobs / highlights / exports
│   │   ├── src/routes/       # API v1 router
│   │   ├── src/jobs/         # BullMQ queues + enqueue helpers
│   │   └── src/storage/      # S3 signed URLs
│   └── ai-worker/            # Python (Poetry) — AI Pipeline
│       └── app/
│           ├── pipeline/     # prepare / coarse / fine / orchestrator
│           ├── detectors/    # player / ball / hoop
│           ├── tracking/     # ball tracker
│           ├── events/       # possession / shot candidate / made basket / confidence / dedup
│           ├── clips/        # highlight range builder
│           ├── ffmpeg/       # metadata / sampling / trim / concat
│           └── worker.py     # RQ/BullMQ consumer + CLI entry
├── packages/
│   └── contracts/            # Shared zod types + OpenAPI 3.1 YAML
├── infra/
│   ├── docker/               # Per-service compose fragments + entrypoints
│   └── compose/              # dev-infra.yml / full-stack.yml
├── docs/
│   ├── architecture/         # architecture-poster.png
│   ├── api/                  # API docs
│   ├── ai/                   # AI pipeline docs
│   └── requirements/1.0/     # Product PRD
├── .github/workflows/        # CI, Docker build, Dependabot
├── docker-compose.yml        # → includes infra/compose/dev-infra.yml
├── turbo.json                # Turbo task graph
└── pnpm-workspace.yaml
```

---

## 🚀 Quick Start (Local Dev)

### 0. Prerequisites

| Tool | Version |
| ---- | ------- |
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| Python | ≥ 3.11 |
| Poetry | latest |
| Flutter | ≥ 3.19 |
| Docker + Compose | v2 |
| ffmpeg / ffprobe | on PATH for AI Worker |

### 1. Start local infra (PostgreSQL + Redis + MinIO)

```bash
docker compose up -d
# includes:
#   - postgres :5432   (user shoot_the_ball / pw shoot_the_ball_dev_password / db shoot_the_ball)
#   - redis    :6379
#   - minio    :9000 (API), :9001 (console — admin / minio_dev_password)
```

> Neon 连接串已写入根目录 `.env` 的 `DATABASE_URL`；若本地想用 Neon 则直接用，不需要本地 postgres。

### 2. Install API dependencies + DB setup

```bash
pnpm install
cd services/api
cp ../../.env.example .env.local   # optional — overrides per package
pnpm db:generate
pnpm db:migrate                    # run Prisma migrations
pnpm db:seed                       # demo user + project
```

Run API dev server:

```bash
pnpm dev
# → http://localhost:4000/v1/health
```

### 3. AI Worker

```bash
cd services/ai-worker
poetry install
poetry run python -m app.worker           # listen to processing + export queues
# or, dry-run the pipeline on a local fixture:
poetry run python -m app.worker --local-video ~/path/to/basketball.mp4
```

### 4. Flutter Mobile

```bash
cd apps/mobile
flutter pub get
flutter run        # simulator / device
```

Flutter 默认使用 `http://10.0.2.2:4000/v1` (Android emulator 宿主机别名)；
iOS simulator / 真机可通过 dart-define 覆盖：

```bash
flutter run --dart-define=API_BASE_URL=http://<your-ip>:4000/v1
```

### 5. Full Docker Stack (optional)

```bash
docker compose -f infra/compose/full-stack.yml up --build
```

---

## 🔑 Environment Variables

Root `.env.example` lists every knob you need. Highlights:

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | PostgreSQL connection (Neon pooler) |
| `DIRECT_DATABASE_URL` | Non-pooled connection for Prisma migrations |
| `REDIS_URL` / `REDIS_HOST` | BullMQ queue |
| `STORAGE_ENDPOINT` / `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | S3 / Cloudflare R2 / MinIO |
| `JWT_SECRET` | Signing key for mobile auth tokens |
| `AI_WORKER_MODE` | `all` / `processing` / `export` |
| `AI_DEFAULT_HIGHLIGHT_PRE_SECONDS` / `POST_SECONDS` | Clip padding around each event |

---

## 🔌 API Overview (v1)

Full OpenAPI spec: [`packages/contracts/openapi/shoot-the-ball.yaml`](packages/contracts/openapi/shoot-the-ball.yaml)

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST   | `/v1/auth/register` / `/login` | JWT auth |
| GET    | `/v1/auth/me` | Current user |
| GET / POST / PATCH / DELETE | `/v1/projects` | CRUD |
| POST   | `/v1/videos/upload-session` | Create direct upload + presigned URL |
| POST   | `/v1/videos/:id/complete` | Mark uploaded; write metadata |
| POST   | `/v1/videos/:id/calibration` | Save hoop / court ROI |
| POST   | `/v1/videos/:id/process` | Enqueue AI processing job |
| GET    | `/v1/videos/:id/highlights` | List highlights |
| GET    | `/v1/jobs/:id` | Job status |
| GET    | `/v1/jobs/:id/events` | SSE progress stream |
| PATCH / DELETE | `/v1/highlights/:id` | Adjust range / soft-delete |
| POST / GET | `/v1/exports` | Individual or merged export → signed download URL |

---

## 🧠 AI Pipeline Stages

See [`docs/ai/README.md`](docs/ai/README.md) for the full 8-stage description
and module map. **The central principle:** coarse-to-fine — only the candidate
windows are re-sampled at a high FPS, which keeps inference cost low.

---

## 🛠 Useful Commands

```bash
# root
pnpm dev              # runs turbo dev across all services
pnpm build            # production builds (turbo cached)
pnpm test             # all test suites
pnpm lint             # all lint
pnpm db:migrate       # Prisma migrate dev
pnpm db:studio        # Prisma Studio web UI
pnpm docker:up        # docker compose up -d (infra only)
```

---

## 🧪 Testing

- **API unit/integration**: `services/api/test/` — Vitest + Supertest
- **AI Worker unit tests**: `services/ai-worker/tests/` — Pytest
- **Flutter widget tests**: `apps/mobile/test/`

CI runs on every push / PR (`.github/workflows/ci.yml`).

---

## 🎯 MVP Phase Roadmap

Per requirements doc (see `docs/requirements/1.0/requirement.md`):

| Phase | Focus |
| ----- | ----- |
| Phase 0 | **AI Feasibility** — real video → FFmpeg → hoop ROI → ball det → tracking → made basket → JSON output |
| Phase 1 | **Backend Skeleton** — PostgreSQL schema, Node API, S3 signed URLs, BullMQ job state machine |
| Phase 2 | **Flutter Upload** — login, project CRUD, video picker, Direct Upload, calibration |
| Phase 3 | **AI Integration** — Node enqueues → Python consumes → writes Highlights → Flutter processing UI |
| Phase 4 | **Review UX** — preview, select/delete, range trim, confidence filter |
| Phase 5 | **Export** — individual + merge, signed download, save/share |
| Phase 6 | **Accuracy & Cost** — thresholds, caching, GPU/inference optimizations, camera profiles |

---

## ⚠️ Explicitly Deferred

- Complex account system, payments, social feed
- Professional multi-track timeline editor
- Player identity / jersey recognition
- Full-video per-frame heavy inference (always Coarse → Fine first)
- Shipping raw large video through Node — use Direct Upload always

---

## 📝 Licensing / Status

Internal pre-release v0.1.0 — MVP scaffold only; detector / classifier modules are empty no-op placeholders until Phase 0 is validated.
