import { prisma } from "../../../db/prisma";
import type { Prisma } from "@prisma/client";

export type ProcessingJobCreateInput = Prisma.Args<
  typeof prisma.processingJob,
  "create"
>["data"];
export type ProcessingJobUpdateInput = Prisma.Args<
  typeof prisma.processingJob,
  "update"
>["data"];

const NON_TERMINAL_STATUSES = [
  "UPLOADED",
  "PREPARING",
  "DETECTING",
  "VERIFYING",
  "GENERATING_CLIPS",
] as const;

export async function findRunningJobByVideoId(videoId: string) {
  return prisma.processingJob.findFirst({
    where: {
      videoId,
      status: { in: NON_TERMINAL_STATUSES as unknown as undefined },
    },
  });
}

export async function createProcessingJob(data: ProcessingJobCreateInput) {
  return prisma.processingJob.create({ data, select: { id: true } });
}

export async function updateProcessingJob(
  jobId: string,
  data: ProcessingJobUpdateInput,
) {
  return prisma.processingJob.update({ where: { id: jobId }, data });
}

export const processingJobsRepository = {
  findRunningJobByVideoId,
  createProcessingJob,
  updateProcessingJob,
};
