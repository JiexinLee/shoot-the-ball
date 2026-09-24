import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { requireAuth } from "../auth/auth.middleware";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { updateJobProgress, updateJobStatus } from "../../jobs/handlers";

/**
 * Jobs（AI 处理任务）模块。
 *
 * 按 requirement.md 第 6 / 12 节约定：
 *   GET /jobs/:id          — 一次性查询状态
 *   GET /jobs/:id/events   — SSE 长连接，周期性推 { progress, stage, status, error }
 *   PATCH /jobs/:id        — 内部接口：ai-worker 通过这个接口实时回写阶段进度
 *
 * 本阶段只实现上面三个。
 *
 * TODO(Jobs):
 *   - GET  /users/me/jobs — 我近期处理过的任务列表（分页）
 *   - POST /jobs/:id/retry — 失败后重试（同 enqueueProcessingJob，注意幂等）
 *   - DELETE /jobs/:id    — 取消任务（BullMQ queue.remove，然后标 ProcessingJobStatus.FAILED）
 */
export const jobsRouter = Router();
jobsRouter.use(requireAuth);

// ========================================================
// Schemas
// ========================================================

const patchJobSchema = z.object({
  status: z
    .enum([
      "UPLOADED",
      "PREPARING",
      "DETECTING",
      "VERIFYING",
      "GENERATING_CLIPS",
      "READY",
      "EXPORTING",
      "EXPORTED",
      "FAILED",
    ])
    .optional(),
  progress: z.number().min(0).max(1).optional(),
  stage: z.string().max(128).optional().nullable(),
  error_message: z.string().max(8192).optional().nullable(),
  pipelineVersion: z.string().max(64).optional().nullable(),
  modelVersion: z.string().max(64).optional().nullable(),
});

// ========================================================
// 1) 查询 job 状态
// ========================================================

jobsRouter.get("/:id", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const isInternalCall = userId === "user_internal_ai_worker";
  const job = isInternalCall
    ? await prisma.processingJob.findUnique({ where: { id } })
    : await prisma.processingJob.findFirst({ where: { id, userId } });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.status(200).json({ job });
});

// ========================================================
// 2) SSE 进度流（符合 requirement.md 第 12 节约定的事件格式）
//
// 事件类型：
//   event: progress    data: { stage, progress }
//   event: completed   data: { status: "READY" | "EXPORTED" }
//   event: failed      data: { error: string }
//   event: heartbeat   data: { ts } （避免一些反向代理 60s 没数据就把连接掐掉）
// ========================================================

jobsRouter.get("/:id/events", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const isInternalCall = userId === "user_internal_ai_worker";
  const job = isInternalCall
    ? await prisma.processingJob.findUnique({ where: { id } })
    : await prisma.processingJob.findFirst({ where: { id, userId } });

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // —— SSE 响应头，标准写法 ——
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx 反向代理时不要缓冲
  res.flushHeaders();

  const startedAt = Date.now();

  const push = (event: string, payload: Record<string, unknown>) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // 第一次立即推当前快照
  push("progress", {
    jobId: id,
    stage: job.stage ?? "Preparing",
    progress: job.progress,
  });
  if (job.status === "READY" || job.status === "EXPORTED") {
    push("completed", { jobId: id, status: job.status });
    res.end();
    return;
  }
  if (job.status === "FAILED") {
    push("failed", { jobId: id, error: job.errorMessage ?? "Unknown error" });
    res.end();
    return;
  }

  let last: { stage: string; progress: number; status: string } = {
    stage: job.stage ?? "",
    progress: job.progress,
    status: job.status as string,
  };
  const pollInterval = env.JOBS_SSE_POLL_INTERVAL_MS;

  const timer = setInterval(async () => {
    try {
      // 最长连 10 分钟就结束，避免浏览器开着一晚上。客户端监听失败后自动重连即可。
      if (Date.now() - startedAt > env.JOBS_SSE_MAX_CONNECTION_MS) {
        push("completed", {
          jobId: id,
          status: "DISCONNECTED",
          message: "Long-poll timeout, please reconnect.",
        });
        clearInterval(timer);
        res.end();
        return;
      }

      const fresh = isInternalCall
        ? await prisma.processingJob.findUnique({ where: { id } })
        : await prisma.processingJob.findFirst({ where: { id, userId } });

      if (!fresh) {
        push("failed", { jobId: id, error: "Job disappeared unexpectedly" });
        clearInterval(timer);
        res.end();
        return;
      }

      // 只有 stage / progress / status 变了才推事件，省带宽和前端 rerender
      if (
        fresh.stage !== last.stage ||
        Math.abs(fresh.progress - last.progress) >= 0.005 ||
        fresh.status !== last.status
      ) {
        push("progress", {
          jobId: id,
          stage: fresh.stage ?? "Preparing",
          progress: fresh.progress,
        });
        last = {
          stage: fresh.stage ?? "",
          progress: fresh.progress,
          status: fresh.status as string,
        };
      }

      if (fresh.status === "READY" || fresh.status === "EXPORTED") {
        push("completed", { jobId: id, status: fresh.status as string });
        clearInterval(timer);
        res.end();
        return;
      }
      if (fresh.status === "FAILED") {
        push("failed", {
          jobId: id,
          error: fresh.errorMessage ?? "Processing failed",
        });
        clearInterval(timer);
        res.end();
      }
    } catch (err) {
      logger.error({ err, jobId: id }, "SSE poll loop error");
    }
  }, pollInterval);

  // 心跳：每 25s 发一个，防止 nginx / 浏览器空闲断开
  const heartbeatTimer = setInterval(() => {
    try {
      push("heartbeat", { ts: Date.now() });
    } catch {
      /* ignore */
    }
  }, 25000);

  // 客户端主动断开（关页面 / 调 eventSource.close()）
  req.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeatTimer);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  });
});

// ========================================================
// 3) PATCH /jobs/:id — ai-worker 回写阶段进度的内部接口
//    权限：只允许「内部 X-Internal-Token」的调用，普通用户不能乱改别人 job 进度。
// ========================================================

jobsRouter.patch("/:id", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const isInternalCall = userId === "user_internal_ai_worker";
  if (!isInternalCall) {
    // 理论上普通用户不需要自己 patch job 状态。直接拒绝，防止前端瞎调。
    res.status(403).json({
      error: "Forbidden: only AI worker internal calls may PATCH jobs",
    });
    return;
  }

  const parsed = patchJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const exists = await prisma.processingJob.findUnique({ where: { id } });
  if (!exists) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const {
    status,
    progress,
    stage,
    error_message,
    pipelineVersion,
    modelVersion,
  } = parsed.data;
  if (status) {
    const statusSafe: string = status as unknown as string;
    const extra: { progress?: number; errorMessage?: string; stage?: string } =
      {};
    if (progress !== undefined) extra.progress = progress;
    if (error_message) extra.errorMessage = error_message;
    if (stage) extra.stage = stage;
    await updateJobStatus(id, statusSafe, extra);
  } else if (progress !== undefined || stage) {
    const stageSafe: string = String(stage || exists.stage || "Preparing");
    await updateJobProgress(
      id,
      stageSafe,
      progress ?? exists.progress,
      error_message ?? undefined,
    );
  }

  if (pipelineVersion !== undefined || modelVersion !== undefined) {
    await prisma.processingJob.update({
      where: { id },
      data: {
        pipelineVersion: pipelineVersion ?? undefined,
        modelVersion: modelVersion ?? undefined,
      },
    });
  }

  logger.info({ jobId: id, status, progress, stage }, "jobs.patched");
  const job = await prisma.processingJob.findUnique({ where: { id } });
  res.status(200).json({ job });
});
