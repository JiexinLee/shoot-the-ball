import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import { prisma } from "../../db/prisma";
import { requireAuth } from "../auth/auth.middleware";
import { enqueueProcessingJob } from "../../jobs/queue";
import type { ProcessingJobPayload } from "../../jobs/handlers";
import {
  createPresignedDownload,
  createPresignedUpload,
  headObject,
} from "../../storage/s3";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

/**
 * 视频上传 + 处理模块。
 *
 * 按 requirements/1.0/requirement.md 第 6 / 7 节的 API 约定实现：
 *   1) POST /videos/upload-session — 创建 Video 记录 + 返回预签名 PUT URL
 *   2) POST /videos/:id/complete     — 客户端传完了，通知 API 校验 + 写入 metadata
 *   3) POST /videos/:id/calibration  — （TODO 后续）用户在 UI 里框了 hoop ROI / court ROI
 *   4) POST /videos/:id/process      — 把视频扔进 Redis 队列，ai-worker 消费后会跑 pipeline
 *   5) POST /videos/:id/highlights/bulk — ai-worker 内部回调：批量写入识别出来的 highlights
 *   6) GET  /videos/:id/highlights   — 前端 Review 页面拉取 highlights 列表
 *   7) GET  /videos/:id              — 拉视频详情 + 当前 processingJob 状态 + 下载源视频签名 URL
 *
 * 本阶段（Phase 1 Backend Skeleton）只实现上面 1/2/4/5/6/7。
 * calibration、删除视频、分页列表等都打上 TODO 注释，后面 Phase 再补。
 */
export const videosRouter = Router();
videosRouter.use(requireAuth);

// ==========================================================================
// 0. 通用 helper
// ==========================================================================

/**
 * 构建最终的 sourceUrl。
 *   - 如果已经有 STORAGE_ENDPOINT（比如 R2）则拼完整 URL 方便直接下载/调试；
 *   - 否则就用 s3://bucket/key 这种协议路径，后续 worker 自己按 s3 client 去解析。
 */
function buildSourceUrl(bucket: string, key: string): string {
  if (env.STORAGE_ENDPOINT) {
    const ep = env.STORAGE_ENDPOINT.replace(/\/$/, "");
    return `${ep}/${bucket}/${key}`;
  }
  return `s3://${bucket}/${key}`;
}

// ==========================================================================
// 1. Request Schemas（zod，参数化查询 & 类型安全）
// ==========================================================================

const uploadSessionSchema = z.object({
  projectId: z.string().min(1).max(64),
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine((s) => {
      const ext = path.extname(s).toLowerCase();
      // requirement.md 提到 MP4 / MOV 等主流格式；这里加个白名单，避免传可执行文件。
      return [".mp4", ".mov", ".mkv", ".m4v", ".webm", ".avi"].includes(ext);
    }, "Unsupported video extension (allowed: mp4 / mov / mkv / m4v / webm / avi)"),
  contentType: z
    .string()
    .min(1)
    .refine(
      (s) => s.startsWith("video/"),
      "Content-Type must start with video/",
    ),
  size: z
    .number()
    .int()
    .positive()
    .max(16 * 1024 * 1024 * 1024, "单个视频最大 16 GB"), // 16 GB 上限
});

const completeUploadSchema = z.object({
  duration: z
    .number()
    .positive()
    .max(12 * 60 * 60)
    .optional(), // 单视频最多 12 小时（防御）
  width: z.number().int().positive().max(8192).optional(),
  height: z.number().int().positive().max(8192).optional(),
  fps: z.number().positive().max(240).optional(),
});

const calibrationSchema = z.object({
  hoopRoi: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  courtRoi: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional()
    .nullable(),
});

// ==========================================================================
// 2. 业务接口
// ==========================================================================

/** ① 申请上传 session：拿预签名 PUT URL，同时在 DB 里建一条 UPLOADING 状态的 Video 记录 */
videosRouter.post("/upload-session", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const parsed = uploadSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { projectId, filename, contentType, size } = parsed.data;

  // 权限校验：用户必须真的有这个 project
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // 生成一个稳定 key：videos/<projectId>/<YYYYMMDD-HHmmss>-<random>-<filename>
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeFilename = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  const storageKey = `videos/${projectId}/${ts}-${Math.random().toString(36).slice(2, 8)}-${safeFilename}`;

  // 先生成预签名 URL（S3 凭据没配时这里会失败，返回 500）
  const signed = await createPresignedUpload(storageKey, contentType, {
    contentLength: size,
  });

  const video = await prisma.video.create({
    data: {
      projectId,
      userId,
      title: safeFilename,
      filename: safeFilename,
      storageKey,
      contentType,
      sizeBytes: BigInt(size),
      status: "UPLOADING",
    },
  });

  logger.info(
    { videoId: video.id, projectId, sizeBytes: size, key: storageKey },
    "videos.upload_session_created",
  );

  res.status(201).json({
    videoId: video.id,
    storageKey,
    uploadUrl: signed.url,
    uploadMethod: signed.method,
    uploadExpiresInSec: signed.expiresInSec,
  });
});

/** ② 客户端传完了 → 校验文件真实存在 → 写入 metadata → status=UPLOADED */
videosRouter.post("/:id/complete", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;
  const parsed = completeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // 安全校验：客户端没上传完就调 complete 的话，直接 409 拒绝，而不是信任它。
  const obj = await headObject("source", video.storageKey);
  if (!obj) {
    res.status(409).json({
      error: "Object not found in storage. Upload to presigned URL first.",
    });
    return;
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      status: "UPLOADED",
      duration: parsed.data.duration,
      width: parsed.data.width,
      height: parsed.data.height,
      fps: parsed.data.fps,
      sizeBytes: BigInt(obj.sizeBytes), // 以对象存储里实际 size 为准，不信任请求里的
      sourceUrl: buildSourceUrl(env.STORAGE_BUCKET_SOURCE, video.storageKey),
    },
  });

  logger.info(
    { videoId: id, sizeBytes: obj.sizeBytes, duration: parsed.data.duration },
    "videos.upload_completed",
  );
  res.status(200).json({ video: updated });
});

/** ③ 校准（用户画篮筐 ROI / 球场 ROI）—— 这里先打桩，后续 Phase 接 UI 再完善。 */
videosRouter.post("/:id/calibration", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;
  const parsed = calibrationSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      calibration: {
        hoopRoi: parsed.data.hoopRoi,
        courtRoi: parsed.data.courtRoi ?? null,
      },
    },
  });

  // TODO(Calibration): 把 calibration 塞进 ProcessingJob 的 input，或直接写进 Storage 元数据里，
  //                    让 ai-worker 的 Pipeline.prepare() 能读到用户给的 hoop ROI，跳过自动检测篮筐。
  logger.info({ videoId: id }, "videos.calibration_saved");
  res.status(200).json({ video: updated });
});

/** ④ 让视频进入 AI 分析：创建 ProcessingJob + 入 BullMQ 队列，Python Worker 会消费它。 */
videosRouter.post("/:id/process", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }
  if (video.status !== "UPLOADED" && video.status !== "FAILED") {
    res.status(409).json({
      error: `Video is in status ${video.status}, cannot start processing`,
    });
    return;
  }

  try {
    const payload: ProcessingJobPayload = {
      videoId: String(id),
      projectId: String(video.projectId),
      userId: String(userId),
    };
    const jobId = await enqueueProcessingJob(payload);
    // 视频的 PROCESSING 状态由 handlers.updateJobStatus 维护，这里不做重复修改
    logger.info({ videoId: id, jobId }, "videos.process_enqueued");
    res.status(202).json({ jobId });
  } catch {
    // enqueueProcessingJob 内部负责关闭 queue
  }
});

/**
 * ⑤ [内部接口] ai-worker 批量写 highlights
 *
 * 要求：ai-worker 必须带 X-Internal-Token 头与 API_INTERNAL_TOKEN 一致，
 *      或者走 JWT 认证的用户本人请求。
 *
 * 注意：这里用 createMany 做批量 INSERT，避免循环一条一条写性能烂。
 */
const bulkHighlightItemSchema = z.object({
  startTime: z.number().min(0),
  endTime: z.number().positive(),
  eventTime: z.number().min(0),
  confidence: z.number().min(0).max(1),
  type: z.enum([
    "MADE_BASKET",
    "THREE_POINTER",
    "ASSIST",
    "STEAL",
    "BLOCK",
    "REBOUND",
    "OTHER",
  ]),
  components: z.record(z.string(), z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  clipUrl: z.string().optional().nullable(),
  clipStorageKey: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
});

videosRouter.post(
  "/:id/highlights/bulk",
  async (req: Request, res: Response) => {
    const userId = req.currentUser!.id ?? "";
    const { id } = req.params;
    const schema = z.object({
      highlights: z.array(bulkHighlightItemSchema).min(0).max(5000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }

    // 额外权限：内部回调用户（user_internal_ai_worker）可以跨 userId 写，但是必须保证 videoId 存在。
    const isInternalCall = userId === "user_internal_ai_worker";
    const video = isInternalCall
      ? await prisma.video.findUnique({ where: { id } })
      : await prisma.video.findFirst({ where: { id, userId } });

    if (!video) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    type InsertRow = {
      videoId: string;
      startTime: number;
      endTime: number;
      eventTime: number;
      confidence: number;
      type:
        | "MADE_BASKET"
        | "THREE_POINTER"
        | "ASSIST"
        | "STEAL"
        | "BLOCK"
        | "REBOUND"
        | "OTHER";
      metadata: object | null;
      clipUrl: string | null;
      clipStorageKey: string | null;
      thumbnailUrl: string | null;
    };

    const toInsert: InsertRow[] = parsed.data.highlights.map((h) => ({
      videoId: String(id),
      startTime: h.startTime,
      endTime: h.endTime,
      eventTime: h.eventTime,
      confidence: h.confidence,
      type: h.type,
      metadata: (h.metadata ?? h.components) as object | null,
      clipUrl: h.clipUrl ?? null,
      clipStorageKey: h.clipStorageKey ?? null,
      thumbnailUrl: h.thumbnailUrl ?? null,
    }));

    // 先把旧 highlights 标记 deleted=true，避免同一个视频多次跑 pipeline 出来重复结果
    // （软删除，符合 requirement 第 73 条 “Delete 只改变 Highlight 状态”）
    const tx: Promise<unknown>[] = [
      prisma.highlight.updateMany({
        where: { videoId: id, deleted: false },
        data: { deleted: true },
      }),
    ];
    if (toInsert.length) {
      tx.push(
        prisma.highlight.createMany({
          data: toInsert as never,
          skipDuplicates: true,
        }),
      );
    } else {
      tx.push(Promise.resolve({ count: 0 }));
    }
    await prisma.$transaction(tx as never);

    logger.info(
      { videoId: id, count: toInsert.length, internal: isInternalCall },
      "videos.highlights_bulk_written",
    );
    res.status(200).json({ inserted: toInsert.length, videoId: id });
  },
);

/** ⑥ 前端拉 highlights 列表（Review 页面用） */
videosRouter.get("/:id/highlights", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const video = await prisma.video.findFirst({ where: { id, userId } });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // TODO(Review): 等高亮量很大（>500）时加分页 cursor / limit & offset
  const highlights = await prisma.highlight.findMany({
    where: { videoId: id, deleted: false },
    orderBy: { eventTime: "asc" },
  });

  res.status(200).json({ highlights });
});

/** ⑦ 视频详情：metadata + 当前 processingJob + 可下载的临时源视频 URL */
videosRouter.get("/:id", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id ?? "";
  const { id } = req.params;

  const video = await prisma.video.findFirst({
    where: { id, userId },
    include: { processingJob: true },
  });
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  let downloadUrl: string | null = null;
  try {
    const d = await createPresignedDownload("source", video.storageKey);
    downloadUrl = d.url;
  } catch (err) {
    logger.warn(
      { err, videoId: id },
      "Failed to generate presigned download for source video",
    );
  }

  res.status(200).json({ video, downloadUrl });
});

// TODO(Videos):
//   - GET  /videos           — 项目下视频分页列表
//   - PATCH /videos/:id      — 修改 title / 等元信息
//   - DELETE /videos/:id     — 软删除（VideoStatus.ARCHIVED）+ 后续生命周期触发对象存储删文件
//   - POST  /videos/:id/reprocess — 手动重新跑一遍 AI 分析（同 /process，但允许 status=PROCESSED 时重跑）
