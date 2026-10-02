import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { requireAuth } from "../auth/auth.middleware";
import { enqueueExportJob } from "../../jobs/queue";
import { createPresignedDownload } from "../../storage/object-storage";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const createExportSchema = z.object({
  projectId: z.string().min(1),
  type: z.enum(["INDIVIDUAL", "MERGE"]),
  format: z.enum(["MP4_HD", "MP4_FULL_HD", "MP4_4K"]).default("MP4_FULL_HD"),
  highlightIds: z.array(z.string().min(1)).nonempty(),
});

async function runMockExportConsumer(exportId: string) {
  try {
    const record = await prisma.export.findUnique({
      where: { id: exportId },
      include: { exportItems: true },
    });
    if (!record) return;

    setTimeout(async () => {
      try {
        await prisma.export.update({
          where: { id: exportId },
          data: { status: "EXPORTING" as const, startedAt: new Date() },
        });
      } catch {
        /* ignore */
      }
    }, 700);

    setTimeout(async () => {
      try {
        // 如果每条 highlight 已经有真裁剪好的 clipStorageKey（exports bucket 下的短 MP4），
        // Export 的成品直接优先用短 clip：
        //   - 选 1 条 → storageKey = 这条 highlight 的 clipStorageKey
        //   - 选 N 条(MERGE) → MVP 先拿第 1 条 highlight 的 clipStorageKey 占位（UI 可以下载一个 4 秒短文件闭环）
        //     未来真实 worker 会用 ffmpeg concat 把 N 段真拼接成一个再 upload exports bucket
        const allHighlights = await prisma.highlight.findMany({
          where: {
            id: { in: record.exportItems.map((i) => i.highlightId) },
          },
          select: { id: true, clipStorageKey: true },
        });
        const firstWithClip = allHighlights.find(
          (h) =>
            typeof h.clipStorageKey === "string" && h.clipStorageKey.length > 0,
        );
        let finalStorageKey: string | null =
          firstWithClip?.clipStorageKey ?? null;
        // 如果全部都还没裁剪（比如 highlight 生成和 trim 都还没完成），兜底用源视频 storageKey
        if (!finalStorageKey && record.exportItems.length > 0) {
          const firstItem = record.exportItems[0];
          if (!firstItem) return;
          const first = await prisma.highlight.findUnique({
            where: { id: firstItem.highlightId },
            select: { video: { select: { storageKey: true } } },
          });
          const key = first?.video?.storageKey;
          finalStorageKey =
            typeof key === "string" && key.length > 0 ? key : null;
        }

        if (finalStorageKey) {
          // 是否是 exports bucket 下的成品 key（clips/<videoId>/<hlId>.mp4 或未来 <exportId>/merged.mp4）
          const isExportsBucket =
            finalStorageKey.startsWith("clips/") ||
            finalStorageKey.startsWith("exports/");
          const storageBucket = isExportsBucket ? "EXPORTS" : "SOURCE";
          // 不引入 DB migration，把存储桶 hint 直接编码在 downloadUrlPrefix（没用到）不行，
          // 所以我们在 storageKey 前缀约定 + storageBucket 记录到 DB 的 downloadUrl 字段（JSON.stringify）
          // 实际上：getExport 那边会根据 key 前缀 clips/ | exports/ 自动判断，这里写 EXPORTED + storageKey 就够了
          await prisma.export.update({
            where: { id: exportId },
            data: {
              status: "EXPORTED" as const,
              storageKey: finalStorageKey,
              // 复用 downloadUrl 字段存个 metadata JSON（真正 downloadUrl 会在 GET 时重新用 presigned 生成，不会读这个）
              downloadUrl: JSON.stringify({
                storageBucket,
                mock: true,
                createdAt: Date.now(),
              }),
              sizeBytes: BigInt(1),
              completedAt: new Date(),
            },
          });
          logger.info(
            {
              exportId,
              mock: true,
              storageKey: finalStorageKey,
              storageBucket,
            },
            "exports.mock_consumer_finished: wrote EXPORTED placeholder",
          );
        } else {
          await prisma.export.update({
            where: { id: exportId },
            data: { status: "EXPORTED" as const },
          });
        }
      } catch (e) {
        logger.error({ exportId, err: e }, "exports.mock_consumer_failed");
      }
    }, 2200);
  } catch (e) {
    logger.error({ exportId, err: e }, "exports.mock_consumer_setup_failed");
  }
}

exportsRouter.post("/", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const parsed = createExportSchema.safeParse(req.body);

  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { projectId, type, format, highlightIds } = parsed.data;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const highlights = await prisma.highlight.findMany({
    where: {
      id: { in: highlightIds },
      video: { projectId, userId },
      deleted: false,
    },
    orderBy: { eventTime: "asc" },
  });

  if (highlights.length !== highlightIds.length) {
    res.status(400).json({ error: "Some highlights not found" });
    return;
  }

  const exportRecord = await prisma.export.create({
    data: {
      projectId,
      userId,
      type,
      format,
      status: "QUEUED",
      exportItems: {
        create: highlights.map(
          (
            h: { id: string; startTime: number; endTime: number },
            idx: number,
          ) => ({
            highlightId: h.id,
            orderIndex: idx,
            startTime: h.startTime,
            endTime: h.endTime,
          }),
        ),
      },
    },
    include: { exportItems: true },
  });

  try {
    await enqueueExportJob({
      exportId: exportRecord.id,
      projectId,
      userId,
    });
  } catch (e) {
    logger.warn(
      { exportId: exportRecord.id, err: e },
      "exports.enqueue_failed: queue unavailable, mock consumer will still run",
    );
  }

  if (env.DEV_MOCK_PROCESSING || env.APP_ENV === "development") {
    void runMockExportConsumer(exportRecord.id);
  }

  res.status(202).json({ export: exportRecord });
});

exportsRouter.get("/:id", async (req: Request, res: Response) => {
  const userId = req.currentUser!.id;
  const { id } = req.params;

  const exportRecord = await prisma.export.findFirst({
    where: { id, userId },
    include: { exportItems: true },
  });
  if (!exportRecord) {
    res.status(404).json({ error: "Export not found" });
    return;
  }

  let downloadUrl: string | null = null;
  if (exportRecord.status === "EXPORTED" && exportRecord.storageKey) {
    try {
      // storageBucket 从 exportRecord.downloadUrl 里读（mock consumer 写了一个 JSON 存桶信息）
      // 兜底：按 storageKey 前缀判断（clips/* / exports/* 默认 exports bucket，其它都是 source bucket）
      const mdBucketStr = (() => {
        const s = exportRecord.downloadUrl;
        if (!s || !s.startsWith("{")) return null;
        try {
          const parsed = JSON.parse(s) as { storageBucket?: unknown };
          return typeof parsed.storageBucket === "string"
            ? parsed.storageBucket
            : null;
        } catch {
          return null;
        }
      })();
      const keyLooksExports =
        exportRecord.storageKey.startsWith("clips/") ||
        exportRecord.storageKey.startsWith("exports/");
      const bucket: "source" | "exports" =
        mdBucketStr?.toUpperCase() === "EXPORTS" ||
        (!mdBucketStr && keyLooksExports)
          ? "exports"
          : "source";
      const signed = await createPresignedDownload(
        bucket,
        exportRecord.storageKey,
      );
      downloadUrl = signed.url;
    } catch (e) {
      logger.warn(
        { exportId: id, err: e },
        "exports.get: createPresignedDownload failed, returning null url",
      );
      downloadUrl = null;
    }
  }

  res.status(200).json({ export: exportRecord, downloadUrl });
});
