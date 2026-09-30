# API Documentation

This folder holds generated or hand-written API documentation.

The canonical OpenAPI 3.1 spec lives at:
`packages/contracts/openapi/shoot-the-ball.yaml`

## Generate docs

- Redoc / Swagger UI can render the YAML directly.
- For TypeScript client codegen, point `openapi-typescript` or Orval at the OpenAPI YAML.

---

## API Service 代码分层（Domain Driven 3-Layer）

`services/api/src/modules/<domain>/` 下每个业务域做严格 **handlers / services / repositories** 三层分层。
以 `videos` 模块为例：

```
services/api/src/modules/videos/
├── videos.routes.ts                 Router 汇总入口（requireAuth + register all handlers）
├── videos.utils.ts                  纯函数 helpers（共享给 service）
├── handlers/                        路由层：zod 校验 → 调 service → 写 HTTP 状态码
│   ├── createUploadSession.ts       POST /videos/upload-session
│   ├── completeUploadById.ts        POST /videos/:id/complete
│   ├── calibrateVideoById.ts        POST /videos/:id/calibration
│   ├── processVideoById.ts          POST /videos/:id/process
│   ├── bulkWriteHighlightsById.ts   POST /videos/:id/highlights/bulk
│   ├── getVideoHighlightsById.ts    GET  /videos/:id/highlights
│   └── getVideoById.ts              GET  /videos/:id
├── services/                        业务层：唯一允许多步编排 + 事务边界
│   ├── upload.service.ts
│   ├── calibration.service.ts
│   ├── processing.service.ts
│   ├── highlights.service.ts
│   └── videos.service.ts
└── repositories/                    数据访问层：Prisma 读写薄封装（零业务 if）
    ├── projects.repository.ts
    ├── videos.repository.ts
    ├── processingJobs.repository.ts
    └── highlights.repository.ts
```

### 依赖方向

```
handlers → services → repositories → Prisma
  │           │
  │           └─→ videos.utils.ts（纯函数）
  └─ Express 只在这一层出现（Request/Response）
```

### 返回协议

所有 service 方法返回 `ServiceResult<T> = { ok?: T; error?: { code: number; message: string } }`，
handler 用统一的 `if (result.error) res.status(...)` 做错误映射。

设计动机与完整约束见 [services/api/README.md](../../services/api/README.md#-代码分层架构domain-driven-3-layer)。
