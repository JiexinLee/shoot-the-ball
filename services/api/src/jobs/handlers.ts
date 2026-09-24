import type { Queue } from "bullmq";
import { prisma } from "../db/prisma";
import { logger } from "../config/logger";

export interface ProcessingJobPayload {
  videoId: string;
  projectId: string;
  userId: string;
}

export interface ExportJobPayload {
  exportId: string;
  projectId: string;
  userId: string;
}

export async function enqueueProcessingJob(
  queue: Queue,
  payload: ProcessingJobPayload,
): Promise<string> {
  const existingJob = await prisma.processingJob.findFirst({
    where: {
      videoId: payload.videoId,
      status: {
        in: [
          "UPLOADED",
          "PREPARING",
          "DETECTING",
          "VERIFYING",
          "GENERATING_CLIPS",
        ],
      },
    },
  });

  if (existingJob) {
    logger.info(
      `Reusing existing processing job ${existingJob.id} for video ${payload.videoId}`,
    );
    return existingJob.id;
  }

  const jobRecord = await prisma.processingJob.create({
    data: {
      videoId: payload.videoId,
      projectId: payload.projectId,
      userId: payload.userId,
      status: "UPLOADED",
      progress: 0,
      errorMessage: null,
    },
  });

  await queue.add("process-video", payload, {
    jobId: jobRecord.id,
  });

  logger.info(
    `Enqueued processing job ${jobRecord.id} for video ${payload.videoId}`,
  );
  return jobRecord.id;
}

export async function enqueueExportJob(
  queue: Queue,
  payload: ExportJobPayload,
): Promise<void> {
  await queue.add("export-video", payload, {
    jobId: payload.exportId,
  });
  logger.info(`Enqueued export job ${payload.exportId}`);
}

export async function updateJobProgress(
  jobId: string | undefined | null,
  stage: string | undefined | null,
  progress: number,
  errorMessage?: string | undefined | null,
): Promise<void> {
  if (!jobId) {
    throw new Error("updateJobProgress: jobId is required");
  }
  const data: {
    progress: number;
    stage: string;
    updatedAt: Date;
    errorMessage?: string;
  } = {
    progress,
    stage: stage || "Preparing",
    updatedAt: new Date(),
  };
  if (errorMessage) {
    data.errorMessage = errorMessage;
  }
  await prisma.processingJob.update({
    where: { id: jobId },
    data: data as never,
  });
}

export async function updateJobStatus(
  jobId: string | undefined | null,
  status: string | undefined | null,
  extra?: {
    progress?: number | null;
    errorMessage?: string | null;
    stage?: string | null;
  },
): Promise<void> {
  if (!jobId) {
    throw new Error("updateJobStatus: jobId is required");
  }
  if (!status) {
    throw new Error("updateJobStatus: status is required");
  }
  const data: {
    status: string;
    updatedAt: Date;
    progress?: number;
    errorMessage?: string;
    stage?: string;
  } = {
    status,
    updatedAt: new Date(),
  };
  if (extra?.progress !== undefined && extra.progress !== null)
    data.progress = extra.progress;
  if (extra?.errorMessage) data.errorMessage = extra.errorMessage;
  if (extra?.stage) data.stage = extra.stage;
  await prisma.processingJob.update({
    where: { id: jobId },
    data: data as never,
  });
}
