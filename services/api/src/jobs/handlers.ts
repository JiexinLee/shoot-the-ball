import { Job } from 'bullmq';
import { prisma } from '../db/prisma';
import { logger } from '../config/logger';
import { Prisma } from '@prisma/client';

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
  queue: import('bullmq').Queue,
  payload: ProcessingJobPayload,
): Promise<string> {
  const existingJob = await prisma.processingJob.findFirst({
    where: {
      videoId: payload.videoId,
      status: { in: ['UPLOADED', 'PREPARING', 'DETECTING', 'VERIFYING', 'GENERATING_CLIPS'] },
    },
  });

  if (existingJob) {
    logger.info(`Reusing existing processing job ${existingJob.id} for video ${payload.videoId}`);
    return existingJob.id;
  }

  const jobRecord = await prisma.processingJob.create({
    data: {
      videoId: payload.videoId,
      projectId: payload.projectId,
      userId: payload.userId,
      status: 'UPLOADED',
      progress: 0,
      errorMessage: null,
    },
  });

  await queue.add('process-video', payload, {
    jobId: jobRecord.id,
  });

  logger.info(`Enqueued processing job ${jobRecord.id} for video ${payload.videoId}`);
  return jobRecord.id;
}

export async function enqueueExportJob(
  queue: import('bullmq').Queue,
  payload: ExportJobPayload,
): Promise<void> {
  await queue.add('export-video', payload, {
    jobId: payload.exportId,
  });
  logger.info(`Enqueued export job ${payload.exportId}`);
}

export async function updateJobProgress(
  jobId: string,
  stage: string,
  progress: number,
  errorMessage?: string,
): Promise<void> {
  const data: Prisma.ProcessingJobUpdateInput = {
    progress,
    stage,
    updatedAt: new Date(),
  };
  if (errorMessage) {
    data.errorMessage = errorMessage;
  }
  await prisma.processingJob.update({
    where: { id: jobId },
    data,
  });
}

export async function updateJobStatus(
  jobId: string,
  status: string,
  extra?: { progress?: number; errorMessage?: string; stage?: string },
): Promise<void> {
  const data: Prisma.ProcessingJobUpdateInput = {
    status,
    updatedAt: new Date(),
  };
  if (extra?.progress !== undefined) data.progress = extra.progress;
  if (extra?.errorMessage !== undefined) data.errorMessage = extra.errorMessage;
  if (extra?.stage !== undefined) data.stage = extra.stage;
  await prisma.processingJob.update({
    where: { id: jobId },
    data,
  });
}
