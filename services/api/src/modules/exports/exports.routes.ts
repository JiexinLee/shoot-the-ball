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
        let placeholderStorageKey: string | null = null;
        const firstItem = record.exportItems[0];
        if (firstItem) {
          const hl = await prisma.highlight.findUnique({
            where: { id: firstItem.highlightId },
            select: {
              video: { select: { storageKey: true } },
            },
          });
          placeholderStorageKey = hl?.video?.storageKey ?? null;
        }

        if (placeholderStorageKey) {
          await prisma.export.update({
            where: { id: exportId },
            data: {
              status: "EXPORTED" as const,
              storageKey: placeholderStorageKey,
              sizeBytes: BigInt(1),
              completedAt: new Date(),
            },
          });
          logger.info(
            { exportId, mock: true, storageKey: placeholderStorageKey },
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
      const signed = await createPresignedDownload(
        "source",
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
