import { prisma } from "../../../db/prisma";
import type { Prisma } from "@prisma/client";

export type VideoCreateInput = Prisma.Args<
  typeof prisma.video,
  "create"
>["data"];
export type VideoUpdateInput = Prisma.Args<
  typeof prisma.video,
  "update"
>["data"];

export async function findByIdAndUserId(id: string, userId: string) {
  return prisma.video.findFirst({ where: { id, userId } });
}

export async function findById(id: string) {
  return prisma.video.findUnique({ where: { id } });
}

export async function findByIdWithProcessingJob(id: string, userId: string) {
  return prisma.video.findFirst({
    where: { id, userId },
    include: { processingJob: true },
  });
}

export async function createVideo(data: VideoCreateInput) {
  return prisma.video.create({ data });
}

export async function updateVideo(id: string, data: VideoUpdateInput) {
  return prisma.video.update({ where: { id }, data });
}

export const videosRepository = {
  findByIdAndUserId,
  findById,
  findByIdWithProcessingJob,
  createVideo,
  updateVideo,
};
