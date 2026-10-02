import { prisma } from "../../../db/prisma";
import type { Prisma } from "@prisma/client";

export type HighlightCreateManyInput = Prisma.HighlightCreateManyInput;

export async function countByVideoId(videoId: string) {
  return prisma.highlight.count({ where: { videoId } });
}

export async function listActiveByVideoId(videoId: string) {
  return prisma.highlight.findMany({
    where: { videoId, deleted: false },
    orderBy: { eventTime: "asc" },
  });
}

export async function listActiveWithStorageByVideoId(videoId: string) {
  return prisma.highlight.findMany({
    where: { videoId, deleted: false },
    orderBy: { eventTime: "asc" },
    include: {
      video: { select: { storageKey: true, id: true } },
    },
  });
}

export async function updateClipArtifacts(
  highlightId: string,
  data: { clipStorageKey: string; clipUrl?: string | null },
) {
  return prisma.highlight.update({
    where: { id: highlightId },
    data: {
      clipStorageKey: data.clipStorageKey,
      clipUrl: data.clipUrl ?? undefined,
    },
    select: { id: true },
  });
}

/**
 * 软删除旧 highlights + 批量写入新 highlights，原子事务。
 * 保持 requirement 第 73 条 "Delete 只改变 Highlight 状态"。
 */
export async function softDeleteAndCreateMany(
  videoId: string,
  inserts: HighlightCreateManyInput[],
) {
  const tx = [] as unknown as Parameters<typeof prisma.$transaction<[]>>[0];
  (tx as unknown as unknown[]).push(
    prisma.highlight.updateMany({
      where: { videoId, deleted: false },
      data: { deleted: true },
    }),
  );
  if (inserts.length) {
    (tx as unknown as unknown[]).push(
      prisma.highlight.createMany({
        data: inserts,
        skipDuplicates: true,
      }),
    );
  } else {
    (tx as unknown as unknown[]).push(Promise.resolve({ count: 0 }));
  }
  return prisma.$transaction(tx);
}

export async function createInTransaction(
  videoId: string,
  items: Array<Omit<HighlightCreateManyInput, "videoId">>,
) {
  const promises = items.map((item) =>
    prisma.highlight.create({
      data: {
        video: { connect: { id: videoId } },
        ...item,
      },
    }),
  );
  return prisma.$transaction(promises);
}

export const highlightsRepository = {
  countByVideoId,
  listActiveByVideoId,
  listActiveWithStorageByVideoId,
  softDeleteAndCreateMany,
  createInTransaction,
  updateClipArtifacts,
};
